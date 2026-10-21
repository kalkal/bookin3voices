// Callable `refineChapter(bookId, chapterId, text, textHash, requestId)`:
// dictated text → AI model (Style Bible + few-shot + context, structured
// output) → VALIDATED, text-anchored suggestions, written in an ATOMIC BATCH to
// the chapter's `suggestions` subcollection (never partially) and returned to
// the client.
//
// Built-in rules:
// - the CLIENT's text is authoritative (during a session the local editor is
//   the master); its hash travels back in the suggestions so the app marks
//   them stale if the text has changed;
// - idempotency: requestId = id of the registry document
//   users/{uid}/refines/{requestId}; a retry reuses the saved response, no
//   duplicates;
// - dedup: a new refinement REPLACES the undecided pending suggestions;
//   accepted/rejected ones stay as history in `revisions` on the app side;
// - a suggestion whose `original` does not match the text is discarded by the
//   server (normalizeSuggestions), never applied blindly;
// - AiProvider Strategy: the active provider is read from
//   users/{uid}/settings/app.aiProvider (default: bedrock, Amazon Nova); the
//   primary and fallback models come from config (models.ts).

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { buildRefineDebugTrace } from './debugTrace';
import { mergeWithHistory, runHistoryCheckWithin } from './history/historyCheck';
import { isRetryableAiError, type AiProvider } from './provider/types';
import { normalizeSuggestions } from './normalizeSuggestions';
import { buildRefinePrompt, REFINE_PROMPT_VERSION } from './refinePrompt';
import {
  bookForRefineSchema,
  chapterForRefineSchema,
  modelOutputSchema,
  parseModelOutput,
  refineChapterInputSchema,
  refineRegistryDocSchema,
  type ModelOutput,
  type RefineChapterInput,
  type RefineChapterResponse,
  type RefineModel,
  type RefineRegistryDoc,
} from './refineTypes';
import { resolveStyleId } from './styles';
import { loadStyleProfileContent, type StyleProfileContent } from './styleProfileContent';
import { textHash } from './textHash';
import { enforceUsageLimit, type UsageAction, type UsageLimit } from '../usage/rateLimit';

/** Ids of the supported AI providers (the app only shows the one in use). */
export const AI_PROVIDER_IDS = ['bedrock', 'gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

const settingsProviderSchema = z.object({ aiProvider: z.enum(AI_PROVIDER_IDS).catch('bedrock') });

export interface RefineChapterDeps {
  db: Firestore;
  /** Models per provider: primary + optional fallback (Strategy). */
  providers: Record<AiProviderId, { primary: RefineModel; fallback?: RefineModel }>;
  /** Provider used when the user has no explicit choice (deployment-level AI_PROVIDER). */
  defaultProvider?: AiProviderId;
  /** Style profile loader, injectable in tests. */
  loadStyleProfile?: (profileId: string) => StyleProfileContent;
  /** Clock, injectable in tests; defaults to Date.now. */
  now?: () => number;
  /** Daily usage caps; defaults to DEFAULT_USAGE_LIMITS. */
  usageLimits?: Record<UsageAction, UsageLimit>;
  /**
   * History check provider per AI provider (two short calls, run in parallel with
   * the refinement). Absent = no history suggestions.
   */
  history?: Record<AiProviderId, () => AiProvider>;
  /**
   * The deployment may return dev debug traces (debugTraceEnabled: DEBUG_TRACE=1
   * or the emulator). Off by default; the trace is never logged or stored.
   */
  debugTrace?: boolean;
}

/**
 * Active provider from users/{uid}/settings/app: missing document or
 * malformed field → default bedrock; an explicit unknown provider →
 * failed-precondition (a clear error beats silently ignoring the choice).
 */
export async function readAiProviderId(
  db: Firestore,
  uid: string,
  defaultId: AiProviderId = 'bedrock',
): Promise<AiProviderId> {
  const snap = await db.doc(`users/${uid}/settings/app`).get();
  if (!snap.exists) return defaultId;
  const data = snap.data() as { aiProvider?: unknown } | undefined;
  const raw = data?.aiProvider;
  if (raw === undefined) return defaultId;
  if (typeof raw !== 'string' || !AI_PROVIDER_IDS.includes(raw as AiProviderId)) {
    throw new HttpsError(
      'failed-precondition',
      `Unsupported AI provider: ${String(raw).slice(0, 40)}.`,
    );
  }
  return settingsProviderSchema.parse({ aiProvider: raw }).aiProvider;
}

/**
 * Builds the refine prompt for a book: the style is the book's own choice
 * (`styleProfileId`); anything unknown or unset falls back to the default.
 * Pure, so the style-to-prompt wiring is unit-tested without Firestore.
 */
export function buildPromptForBook(args: {
  book: {
    title: string;
    genre: string;
    language: string;
    synopsis: string;
    styleProfileId: string | null;
  };
  chapter: { title: string; outline: { summary: string; beats: string[] } | null };
  text: string;
  loadStyleProfile: (profileId: string) => StyleProfileContent;
}): ReturnType<typeof buildRefinePrompt> {
  const { book, chapter, text, loadStyleProfile } = args;
  const profile = loadStyleProfile(resolveStyleId(book.styleProfileId));
  return buildRefinePrompt({
    styleBible: profile.styleBible,
    fewShots: profile.fewShots,
    book: {
      title: book.title,
      genre: book.genre,
      language: book.language,
      synopsis: book.synopsis,
    },
    chapter: { title: chapter.title, outline: chapter.outline },
    text,
  });
}

/** Reads the book and chapter for the prompt context (synopsis + outline). */
async function readContext(db: Firestore, uid: string, input: RefineChapterInput) {
  const bookRef = db.doc(`users/${uid}/books/${input.bookId}`);
  const chapterRef = bookRef.collection('chapters').doc(input.chapterId);
  const [bookSnap, chapterSnap] = await Promise.all([bookRef.get(), chapterRef.get()]);
  if (!bookSnap.exists) throw new HttpsError('not-found', 'Book not found.');
  if (!chapterSnap.exists) throw new HttpsError('not-found', 'Chapter not found.');
  // schemas use .catch(): the context is an aid, so a malformed field does not
  // block the refinement (unlike the outline, where it is the raw material)
  const book = bookForRefineSchema.parse(bookSnap.data() ?? {});
  const chapter = chapterForRefineSchema.parse(chapterSnap.data() ?? {});
  return { book, chapter, chapterRef };
}

/**
 * Calls the model: two attempts on the primary (retry on non-conforming output
 * or a retryable error), then one on the fallback if configured; current flash
 * models can answer 503 at peak times.
 */
async function generateValidatedSuggestions(
  primary: RefineModel,
  fallback: RefineModel | undefined,
  prompt: ReturnType<typeof buildRefinePrompt>,
): Promise<{ output: ModelOutput; dropped: number; modelName: string }> {
  const attempts: RefineModel[] = [primary, primary];
  if (
    fallback !== undefined &&
    fallback.modelName !== '' &&
    fallback.modelName !== primary.modelName
  ) {
    attempts.push(fallback);
  }
  let lastIssue = '';
  for (const model of attempts) {
    let candidate: unknown;
    try {
      candidate = await model.generate(prompt);
    } catch (error) {
      lastIssue = error instanceof Error ? error.message : String(error);
      logger.warn('refineChapter: model call failed', {
        model: model.modelName,
        errorName: error instanceof Error ? error.name : typeof error,
        issue: lastIssue.slice(0, 300),
      });
      if (error instanceof SyntaxError || isRetryableAiError(error)) continue;
      if (error instanceof HttpsError) throw error;
      // other errors (e.g. 400): retrying the same input won't help, but the
      // fallback may succeed (primary model retired or schema rejected)
      continue;
    }
    const lenient = parseModelOutput(candidate);
    if (lenient) {
      if (lenient.dropped > 0) {
        logger.warn('refineChapter: dropped invalid or over-limit suggestions', {
          model: model.modelName,
          dropped: lenient.dropped,
        });
      }
      return { output: lenient.output, dropped: lenient.dropped, modelName: model.modelName };
    }
    const parsed = modelOutputSchema.safeParse(candidate);
    lastIssue = parsed.success
      ? 'schema not respected'
      : (parsed.error.issues[0]?.message ?? 'schema not respected');
    logger.warn('refineChapter: model output failed validation', {
      model: model.modelName,
      issue: lastIssue.slice(0, 300),
    });
  }
  throw new HttpsError(
    'unavailable',
    `The model did not produce valid suggestions: ${lastIssue.slice(0, 200)}. Try again.`,
  );
}

function toResponse(requestId: string, doc: RefineRegistryDoc): RefineChapterResponse {
  return {
    requestId,
    textHash: doc.textHash,
    model: doc.model,
    promptVersion: doc.promptVersion,
    suggestions: doc.suggestions,
    discarded: doc.discarded,
  };
}

/** Core of the callable, testable directly against the Firestore emulator. */
export async function runRefineChapter(
  deps: RefineChapterDeps,
  uid: string,
  input: RefineChapterInput,
): Promise<RefineChapterResponse> {
  const {
    db,
    providers,
    loadStyleProfile = loadStyleProfileContent,
    now = Date.now,
    usageLimits,
  } = deps;

  // integrity: the declared hash must really be the hash of the text sent
  if (textHash(input.text) !== input.textHash) {
    throw new HttpsError('invalid-argument', 'textHash does not match the text sent.');
  }

  const registryRef = db.doc(`users/${uid}/refines/${input.requestId}`);

  // Network retry: registry already written → same response, no second model
  // call. The same requestId on another chapter is a client error.
  const existingSnap = await registryRef.get();
  if (existingSnap.exists) {
    const existing = refineRegistryDocSchema.safeParse(existingSnap.data());
    if (
      !existing.success ||
      existing.data.bookId !== input.bookId ||
      existing.data.chapterId !== input.chapterId
    ) {
      throw new HttpsError('already-exists', 'requestId already used for another refinement.');
    }
    return toResponse(input.requestId, existing.data);
  }

  // Anti-abuse cap: counted only here, after the idempotency short-circuit (a
  // network retry consumes no budget) and before touching the model.
  await enforceUsageLimit({ db, uid, action: 'refineChapter', now, limits: usageLimits });

  const providerId = await readAiProviderId(db, uid, deps.defaultProvider);
  const provider = providers[providerId];

  const { book, chapter, chapterRef } = await readContext(db, uid, input);
  const prompt = buildPromptForBook({
    book,
    chapter,
    text: input.text,
    loadStyleProfile,
  });

  // the history check runs in parallel: it adds no latency, and a failure only
  // means no history suggestions (degraded mode), never a failed refinement
  const historyProvider = deps.history?.[providerId];
  const [{ output, dropped, modelName }, history] = await Promise.all([
    generateValidatedSuggestions(provider.primary, provider.fallback, prompt),
    historyProvider === undefined
      ? Promise.resolve(null)
      : runHistoryCheckWithin({
          provider: historyProvider(),
          text: input.text,
          language: book.language,
        }),
  ]);
  if (history?.error !== undefined) {
    logger.warn('refineChapter: history check failed, refinement without history', {
      requestId: input.requestId,
      kind: history.error.kind,
      calls: history.calls,
    });
  }
  const merged = {
    suggestions: mergeWithHistory(output.suggestions, history?.suggestions ?? [], input.text),
  };
  const normalized = normalizeSuggestions(merged, input.text, input.textHash, input.requestId);
  const traceRequested = deps.debugTrace === true && input.debug === true;
  const { suggestions } = normalized;
  const discarded = normalized.discarded + dropped + (history?.dropped ?? 0);
  if (normalized.densityCut > 0) {
    logger.info('refineChapter: density cap applied', {
      requestId: input.requestId,
      raw: merged.suggestions.length,
      kept: suggestions.length,
      cut: normalized.densityCut,
    });
  }

  // Atomic batch: registry + pending dedup + new suggestions in ONE
  // transaction, never 20 out of 40 because of a mid-way timeout. If another
  // call with the same requestId won the race, its result is reused.
  const suggestionsRef = chapterRef.collection('suggestions');
  const doc = await db.runTransaction<RefineRegistryDoc>(async (tx) => {
    const snap = await tx.get(registryRef);
    if (snap.exists) {
      const existing = refineRegistryDocSchema.safeParse(snap.data());
      if (
        !existing.success ||
        existing.data.bookId !== input.bookId ||
        existing.data.chapterId !== input.chapterId
      ) {
        throw new HttpsError('already-exists', 'requestId already used for another refinement.');
      }
      return existing.data;
    }

    // dedup: the new refinement replaces the undecided pending suggestions
    const pendingSnap = await tx.get(suggestionsRef.where('state', '==', 'pending'));

    const fresh: RefineRegistryDoc = {
      schemaVersion: 1,
      bookId: input.bookId,
      chapterId: input.chapterId,
      textHash: input.textHash,
      model: modelName,
      promptVersion: REFINE_PROMPT_VERSION,
      suggestions,
      discarded,
      createdAt: now(),
    };

    for (const pending of pendingSnap.docs) tx.delete(pending.ref);
    for (const suggestion of suggestions) {
      tx.set(suggestionsRef.doc(suggestion.id), {
        schemaVersion: 1,
        ...suggestion,
        requestId: input.requestId,
        model: modelName,
        promptVersion: REFINE_PROMPT_VERSION,
        createdAt: fresh.createdAt,
      });
    }
    tx.set(registryRef, fresh);
    return fresh;
  });

  const response = toResponse(input.requestId, doc);
  if (!traceRequested) return response;
  return {
    ...response,
    debugTrace: buildRefineDebugTrace({
      promptVersion: doc.promptVersion,
      model: doc.model,
      book,
      chapter,
      text: input.text,
      textHash: input.textHash,
      raw: output.suggestions,
      parseDropped: dropped,
      history,
      merged: merged.suggestions,
      normalized,
    }),
  };
}

/** Callable handler: auth + input validation, then runRefineChapter. */
export function createRefineChapterHandler(
  deps: RefineChapterDeps,
): (request: CallableRequest<unknown>) => Promise<RefineChapterResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const parsed = refineChapterInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        'Expected { bookId, chapterId, text, textHash, requestId }.',
      );
    }
    return runRefineChapter(deps, uid, parsed.data);
  };
}
