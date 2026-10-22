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

import { buildRefineDebugTrace } from './debugTrace';
import { mergeWithHistory, runHistoryCheckWithin } from './history/historyCheck';
import { isRetryableAiError, type AiProvider } from './provider/types';
import { emptyReasonOf, normalizeSuggestions } from './normalizeSuggestions';
import { buildRefinePrompt, REFINE_PROMPT_VERSION } from './refinePrompt';
import {
  bookForRefineSchema,
  mainKindsOf,
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
  type SuggestionKind,
} from './refineTypes';
import { pendingToReplace, selectionProblem } from './refineSelection';
import { resolveStyleId } from './styles';
import { loadStyleProfileContent, type StyleProfileContent } from './styleProfileContent';
import { textHash } from './textHash';
import {
  assertDemoTextFits,
  demoUsageLimits,
  requireDemoAccess,
  type CallerClaims,
} from '../demo/demoGate';
import { reportSuspiciousInput } from '../security/suspiciousInput';
import { enforceUsageLimit, type UsageAction, type UsageLimit } from '../usage/rateLimit';

/** Amazon Nova on Bedrock is the only provider. */
export const AI_PROVIDER_IDS = ['bedrock'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export interface RefineChapterDeps {
  db: Firestore;
  /** Models per provider: primary + optional fallback (Strategy). */
  providers: Record<AiProviderId, { primary: RefineModel; fallback?: RefineModel }>;
  /** The deployment's provider (AI_PROVIDER); the user's settings never choose it. */
  defaultProvider?: AiProviderId;
  /** Style profile loader, injectable in tests. */
  loadStyleProfile?: (profileId: string) => StyleProfileContent;
  /** Clock, injectable in tests; defaults to Date.now. */
  now?: () => number;
  /** Daily usage caps; defaults to DEFAULT_USAGE_LIMITS. */
  usageLimits?: Partial<Record<UsageAction, UsageLimit>>;
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
  /** Judges' demo (DEMO_GATE=1): access code, demo caps and text limit (demo/demoGate.ts). */
  demoGate?: boolean;
}

/**
 * «Storico»: the period check runs on every chapter, even one that does not
 * name its period (the synopsis is asked then). Other styles: only chapters
 * that name a period. Pure, so the style wiring is unit-tested.
 */
export function historyOptionsForBook(book: { styleProfileId: string | null; synopsis: string }): {
  everyChapter?: { synopsis: string };
} {
  return resolveStyleId(book.styleProfileId) === 'historical'
    ? { everyChapter: { synopsis: book.synopsis } }
    : {};
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
  /** «Rifinisci la selezione»: the part to refine; `text` is then context. */
  selection?: string;
  kinds?: readonly SuggestionKind[];
  loadStyleProfile: (profileId: string) => StyleProfileContent;
}): ReturnType<typeof buildRefinePrompt> {
  const { book, chapter, text, selection, kinds, loadStyleProfile } = args;
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
    ...(selection === undefined ? {} : { selection }),
    ...(kinds === undefined ? {} : { kinds }),
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
    // the provider's own message stays in the log above: it may name the AWS
    // account or resources, never something to send to a client
    'The model did not produce valid suggestions. Try again.',
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
    ...(doc.emptyReason === undefined ? {} : { emptyReason: doc.emptyReason }),
  };
}

/** Core of the callable, testable directly against the Firestore emulator. */
export async function runRefineChapter(
  deps: RefineChapterDeps,
  uid: string,
  input: RefineChapterInput,
  claims?: CallerClaims,
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
  // judges' demo: open demo + this phone's code, then the demo's caps and text limit
  const demo = deps.demoGate === true ? await requireDemoAccess(db, uid, claims, now()) : undefined;
  if (demo !== undefined) assertDemoTextFits(input.text, demo);
  const limits = demo !== undefined ? demoUsageLimits(demo) : usageLimits;
  // «Rifinisci la selezione»: the range must sit in the text and hold enough words
  const range = input.range;
  if (range !== undefined) {
    const problem = selectionProblem(input.text, range);
    if (problem !== null) {
      throw new HttpsError('invalid-argument', `Selection not usable: ${problem}.`);
    }
  }
  const scopeText = range === undefined ? input.text : input.text.slice(range.from, range.to);

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
  await enforceUsageLimit({ db, uid, action: 'refineChapter', now, limits });
  // monitoring only, after the cap: free text is data, flagged by kind, never refused
  reportSuspiciousInput('chapterText', input.text, { requestId: input.requestId });

  // an `aiProvider` left in an old users/{uid}/settings/app is ignored
  const providerId = deps.defaultProvider ?? 'bedrock';
  const provider = providers[providerId];

  const { book, chapter, chapterRef } = await readContext(db, uid, input);
  const prompt = buildPromptForBook({
    book,
    chapter,
    text: input.text,
    ...(range === undefined ? {} : { selection: scopeText }),
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    loadStyleProfile,
  });
  if (range !== undefined) {
    logger.info('refineChapter: selection', {
      requestId: input.requestId,
      from: range.from,
      to: range.to,
      words: scopeText.match(/\S+/g)?.length ?? 0,
    });
  }

  // the history check runs in parallel: it adds no latency, and a failure only
  // means no history suggestions (degraded mode), never a failed refinement
  // only the kinds the user chose: no main call without style/grammar/pacing,
  // no history check without «period»
  const mainKinds = mainKindsOf(input.kinds);
  const wantsHistory = input.kinds === undefined || input.kinds.includes('history');
  if (input.kinds !== undefined) {
    logger.info('refineChapter: kinds', { requestId: input.requestId, kinds: input.kinds });
  }
  const historyProvider = wantsHistory ? deps.history?.[providerId] : undefined;
  const [{ output, dropped, modelName }, history] = await Promise.all([
    mainKinds.length === 0
      ? Promise.resolve({
          output: { suggestions: [] },
          dropped: 0,
          modelName: provider.primary.modelName,
        })
      : generateValidatedSuggestions(provider.primary, provider.fallback, prompt),
    historyProvider === undefined
      ? Promise.resolve(null)
      : runHistoryCheckWithin({
          provider: historyProvider(),
          text: scopeText,
          language: book.language,
          ...historyOptionsForBook(book),
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
    suggestions: mergeWithHistory(output.suggestions, history?.suggestions ?? [], scopeText),
  };
  const normalized = normalizeSuggestions(merged, input.text, input.textHash, input.requestId, {
    rejected: new Set(input.rejected ?? []),
    ...(range === undefined ? {} : { range }),
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
  });
  if (normalized.alreadyRejected > 0) {
    logger.info('refineChapter: already rejected proposals dropped', {
      requestId: input.requestId,
      alreadyRejected: normalized.alreadyRejected,
    });
  }
  const traceRequested = deps.debugTrace === true && input.debug === true;
  const { suggestions } = normalized;
  const emptyReason = emptyReasonOf(normalized);
  if (emptyReason !== undefined) {
    logger.info('refineChapter: no suggestions', { requestId: input.requestId, emptyReason });
  }
  const discarded = normalized.discarded + dropped + (history?.dropped ?? 0);
  if (normalized.unsafe > 0) {
    // proposals that would have deleted or replaced text: counts only, never the text
    logger.warn('refineChapter: unsafe proposals dropped', {
      requestId: input.requestId,
      unsafe: normalized.unsafe,
      kept: suggestions.length,
    });
  }
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
      ...(emptyReason === undefined ? {} : { emptyReason }),
      createdAt: now(),
    };

    // a selection replaces only the pendings it touches (and any on an older text)
    const replace = new Set(
      pendingToReplace(
        pendingSnap.docs.map((d) => {
          const data = d.data() as {
            kind?: unknown;
            span?: { from?: unknown; to?: unknown };
            textHash?: unknown;
          };
          return {
            id: d.id,
            ...(typeof data.kind === 'string' ? { kind: data.kind } : {}),
            span: {
              from: typeof data.span?.from === 'number' ? data.span.from : 0,
              to: typeof data.span?.to === 'number' ? data.span.to : Number.MAX_SAFE_INTEGER,
            },
            textHash: typeof data.textHash === 'string' ? data.textHash : '',
          };
        }),
        input.textHash,
        range,
        input.kinds,
      ),
    );
    for (const pending of pendingSnap.docs) if (replace.has(pending.id)) tx.delete(pending.ref);
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
      ...(range === undefined ? {} : { range }),
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
    return runRefineChapter(deps, uid, parsed.data, request.auth?.token);
  };
}
