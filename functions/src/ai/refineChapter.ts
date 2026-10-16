// Callable `refineChapter(bookId, chapterId, text, textHash, requestId)`
// testo dettato → modello AI (Style Bible +
// few-shot + contesto, structured output) → suggerimenti puntuali VALIDATI e
// ancorati al testo, scritti in un BATCH ATOMICO nella sottocollezione
// `suggestions` del capitolo (mai parziali) e restituiti al client.
//
// Regole incorporate:
// - il testo che fa fede è quello del CLIENT (durante la sessione l'editor
//   locale è il master); il suo hash torna nei suggerimenti
// così l'app li marca stale se il testo è cambiato;
// - idempotenza: requestId = id del registro users/{uid}/refines/{requestId};
//   un retry riusa la risposta salvata, zero doppioni;
// - dedup: una nuova rifinitura SOSTITUISCE i pending non decisi;
//   accettati/rifiutati restano storia in `revisions` lato app;
// - un suggerimento il cui `original` non combacia col testo viene scartato
//   dal server (normalizeSuggestions), mai applicato alla cieca;
// - Strategy AiProvider: il provider attivo si legge da
//   users/{uid}/settings/app.aiProvider (predefinito: bedrock, Amazon Nova); il
//   modello primario e la riserva arrivano da config (models.ts).

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { isRetryableAiError } from './provider/types';
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

/** Id dei provider AI supportati (catalogo condiviso con l'app). */
export const AI_PROVIDER_IDS = ['bedrock', 'gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

const settingsProviderSchema = z.object({ aiProvider: z.enum(AI_PROVIDER_IDS).catch('bedrock') });

export interface RefineChapterDeps {
  db: Firestore;
  /** Modelli per provider: primario + eventuale riserva (Strategy). */
  providers: Record<AiProviderId, { primary: RefineModel; fallback?: RefineModel }>;
  /** Provider used when the user has no explicit choice (deployment-level AI_PROVIDER). */
  defaultProvider?: AiProviderId;
  /** Caricamento profilo di stile iniettabile nei test. */
  loadStyleProfile?: (profileId: string) => StyleProfileContent;
  /** Orologio iniettabile nei test; default Date.now. */
  now?: () => number;
  /** Tetti d'uso giornalieri; default DEFAULT_USAGE_LIMITS. */
  usageLimits?: Record<UsageAction, UsageLimit>;
}

/**
 * Provider attivo da users/{uid}/settings/app: documento assente o
 * campo malformato → default bedrock; un provider sconosciuto esplicito →
 * failed-precondition (meglio un errore chiaro che ignorare la scelta).
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
      `Motore AI non supportato: ${String(raw).slice(0, 40)}.`,
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

/** Legge libro e capitolo per il contesto del prompt (sinossi + outline). */
async function readContext(db: Firestore, uid: string, input: RefineChapterInput) {
  const bookRef = db.doc(`users/${uid}/books/${input.bookId}`);
  const chapterRef = bookRef.collection('chapters').doc(input.chapterId);
  const [bookSnap, chapterSnap] = await Promise.all([bookRef.get(), chapterRef.get()]);
  if (!bookSnap.exists) throw new HttpsError('not-found', 'Libro inesistente.');
  if (!chapterSnap.exists) throw new HttpsError('not-found', 'Capitolo inesistente.');
  // schemi con .catch(): il contesto è un aiuto, un campo malformato non
  // blocca la rifinitura (a differenza dell'outline, dove è materia prima)
  const book = bookForRefineSchema.parse(bookSnap.data() ?? {});
  const chapter = chapterForRefineSchema.parse(chapterSnap.data() ?? {});
  return { book, chapter, chapterRef };
}

/**
 * Chiama il modello: due tentativi sul primario (retry su output non conforme
 * o errore ritentabile), poi uno sulla riserva se configurata — i flash
 * correnti possono rispondere 503 nei picchi.
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
      // altri errori (es. 400): il retry sullo stesso input non aiuta, ma la
      // riserva può farcela (modello primario ritirato o schema rifiutato)
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
      ? 'schema non rispettato'
      : (parsed.error.issues[0]?.message ?? 'schema non rispettato');
    logger.warn('refineChapter: model output failed validation', {
      model: model.modelName,
      issue: lastIssue.slice(0, 300),
    });
  }
  throw new HttpsError(
    'unavailable',
    `Il modello non ha prodotto suggerimenti validi: ${lastIssue.slice(0, 200)}. Riprova.`,
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

/** Cuore della callable, testabile direttamente contro l'emulatore Firestore. */
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

  // integrità: l'hash dichiarato deve essere davvero l'hash del testo inviato
  if (textHash(input.text) !== input.textHash) {
    throw new HttpsError('invalid-argument', 'textHash non combacia col testo inviato.');
  }

  const registryRef = db.doc(`users/${uid}/refines/${input.requestId}`);

  // Retry di rete: registro già scritto → stessa risposta, nessuna seconda
  // chiamata al modello. Stesso requestId su un altro capitolo = errore client.
  const existingSnap = await registryRef.get();
  if (existingSnap.exists) {
    const existing = refineRegistryDocSchema.safeParse(existingSnap.data());
    if (
      !existing.success ||
      existing.data.bookId !== input.bookId ||
      existing.data.chapterId !== input.chapterId
    ) {
      throw new HttpsError('already-exists', 'requestId già usato per un’altra rifinitura.');
    }
    return toResponse(input.requestId, existing.data);
  }

  // Tetto anti-abuso: contato solo qui, dopo lo short-circuit di
  // idempotenza (un retry di rete non consuma budget) e prima di toccare Gemini.
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

  const { output, dropped, modelName } = await generateValidatedSuggestions(
    provider.primary,
    provider.fallback,
    prompt,
  );
  const normalized = normalizeSuggestions(output, input.text, input.textHash, input.requestId);
  const { suggestions } = normalized;
  const discarded = normalized.discarded + dropped;

  // Batch atomico: registro + dedup dei pending + nuovi suggerimenti
  // in UNA transazione — mai 20 su 40 per un timeout a metà. Se un'altra
  // chiamata con lo stesso requestId ha vinto la corsa, si riusa la sua.
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
        throw new HttpsError('already-exists', 'requestId già usato per un’altra rifinitura.');
      }
      return existing.data;
    }

    // dedup: la nuova rifinitura sostituisce i pending non decisi
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

  return toResponse(input.requestId, doc);
}

/** Handler della callable: auth + validazione input, poi runRefineChapter. */
export function createRefineChapterHandler(
  deps: RefineChapterDeps,
): (request: CallableRequest<unknown>) => Promise<RefineChapterResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Accesso richiesto.');
    }
    const parsed = refineChapterInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        'Attesi { bookId, chapterId, text, textHash, requestId }.',
      );
    }
    return runRefineChapter(deps, uid, parsed.data);
  };
}
