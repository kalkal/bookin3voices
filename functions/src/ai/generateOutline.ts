// Callable `generateOutline(bookId, synopsis, requestId)` (
// Fase 2): sinossi → Gemini (tier Pro, structured output) → scaletta capitoli
// {titolo, riassunto, beat[]} VALIDATA con Zod. La callable NON scrive capitoli:
// restituisce la proposta, l'anteprima corkboard e il merge additivo (che non
// tocca mai capitoli con testo) sono dell'app.
//
// Idempotenza: il requestId è l'id del documento
// users/{uid}/outlines/{requestId} — un retry di rete riusa l'outline già
// generato (stessa risposta, nessuna seconda chiamata a Gemini).

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { enforceUsageLimit, type UsageAction, type UsageLimit } from '../usage/rateLimit';
import { buildOutlinePrompt, OUTLINE_PROMPT_VERSION } from './outlinePrompt';
import {
  bookForOutlineSchema,
  chapterForOutlineSchema,
  generateOutlineInputSchema,
  outlineRegistryDocSchema,
  outlineSchema,
  type GenerateOutlineInput,
  type GenerateOutlineResponse,
  type Outline,
  type OutlineModel,
  type OutlineRegistryDoc,
} from './types';

export interface GenerateOutlineDeps {
  db: Firestore;
  model: OutlineModel;
  /** Orologio iniettabile nei test; default Date.now. */
  now?: () => number;
  /** Tetti d'uso giornalieri; default DEFAULT_USAGE_LIMITS. */
  usageLimits?: Record<UsageAction, UsageLimit>;
}

/**
 * Ripulisce il candidato PRIMA della validazione: trim dei testi e beat vuoti
 * scartati. Solo igiene strutturale deterministica — tutto il resto (limiti,
 * campi mancanti, tipi) resta allo schema Zod: un candidato che non passa
 * dopo la pulizia è un output non conforme.
 */
export function sanitizeOutlineCandidate(candidate: unknown): unknown {
  if (typeof candidate !== 'object' || candidate === null) return candidate;
  const chapters = (candidate as { chapters?: unknown }).chapters;
  if (!Array.isArray(chapters)) return candidate;
  return {
    chapters: chapters.map((chapter) => {
      if (typeof chapter !== 'object' || chapter === null) return chapter;
      const { title, summary, beats } = chapter as {
        title?: unknown;
        summary?: unknown;
        beats?: unknown;
      };
      return {
        title: typeof title === 'string' ? title.trim() : title,
        summary: typeof summary === 'string' ? summary.trim() : summary,
        beats: Array.isArray(beats)
          ? beats
              .map((beat) => (typeof beat === 'string' ? beat.trim() : beat))
              .filter((beat) => beat !== '')
          : beats,
      };
    }),
  };
}

/** Legge il libro (contesto del prompt) o solleva errori parlanti. */
async function readBookForOutline(db: Firestore, uid: string, bookId: string) {
  const bookRef = db.doc(`users/${uid}/books/${bookId}`);
  const bookSnap = await bookRef.get();
  if (!bookSnap.exists) {
    throw new HttpsError('not-found', 'Libro inesistente.');
  }
  const parsed = bookForOutlineSchema.safeParse(bookSnap.data());
  if (!parsed.success) {
    throw new HttpsError('failed-precondition', 'Documento libro non valido per la scaletta.');
  }

  // Capitoli con testo = contesto intoccabile: entrano nel
  // prompt come "già scritti, non riproporre". Un capitolo malformato blocca:
  // meglio un errore chiaro che una scaletta costruita su contesto monco.
  const chaptersSnap = await bookRef.collection('chapters').orderBy('order').get();
  const writtenChapterTitles: string[] = [];
  for (const doc of chaptersSnap.docs) {
    const chapter = chapterForOutlineSchema.safeParse(doc.data());
    if (!chapter.success) {
      throw new HttpsError('failed-precondition', `Capitolo ${doc.id} non valido per la scaletta.`);
    }
    if (chapter.data.rawText.trim() !== '') {
      writtenChapterTitles.push(chapter.data.title);
    }
  }

  return { book: parsed.data, writtenChapterTitles };
}

/** Chiama il modello con UN retry sull'output non conforme. */
async function generateValidatedOutline(
  model: OutlineModel,
  prompt: ReturnType<typeof buildOutlinePrompt>,
): Promise<Outline> {
  let lastIssue = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let candidate: unknown;
    try {
      candidate = await model.generate(prompt);
    } catch (error) {
      // errore di trasporto o JSON illeggibile: stesso trattamento del non conforme
      lastIssue = error instanceof Error ? error.message : String(error);
      logger.warn('generateOutline: model call failed', {
        model: model.modelName,
        errorName: error instanceof Error ? error.name : typeof error,
        issue: lastIssue.slice(0, 300),
      });
      continue;
    }
    const parsed = outlineSchema.safeParse(sanitizeOutlineCandidate(candidate));
    if (parsed.success) return parsed.data;
    lastIssue = parsed.error.issues[0]?.message ?? 'schema non rispettato';
  }
  throw new HttpsError(
    'unavailable',
    `Il modello non ha prodotto una scaletta valida: ${lastIssue.slice(0, 200)}. Riprova.`,
  );
}

function toResponse(requestId: string, doc: OutlineRegistryDoc): GenerateOutlineResponse {
  return {
    requestId,
    bookId: doc.bookId,
    model: doc.model,
    promptVersion: doc.promptVersion,
    createdAt: doc.createdAt,
    chapters: doc.outline.chapters,
  };
}

/** Cuore della callable, testabile direttamente contro l'emulatore Firestore. */
export async function runGenerateOutline(
  deps: GenerateOutlineDeps,
  uid: string,
  input: GenerateOutlineInput,
): Promise<GenerateOutlineResponse> {
  const { db, model, now = Date.now, usageLimits } = deps;
  const registryRef = db.doc(`users/${uid}/outlines/${input.requestId}`);

  // Retry di rete: se il registro esiste già si riusa l'outline salvato,
  // senza seconda chiamata al modello. Stesso requestId su un altro libro =
  // errore del client (come exportBook).
  const existingSnap = await registryRef.get();
  if (existingSnap.exists) {
    const existing = outlineRegistryDocSchema.safeParse(existingSnap.data());
    if (!existing.success || existing.data.bookId !== input.bookId) {
      throw new HttpsError('already-exists', 'requestId già usato per un’altra scaletta.');
    }
    return toResponse(input.requestId, existing.data);
  }

  // Tetto anti-abuso: dopo lo short-circuit di idempotenza (il retry
  // riusa l'outline salvato, budget zero) e prima della chiamata a Gemini Pro.
  await enforceUsageLimit({ db, uid, action: 'generateOutline', now, limits: usageLimits });

  const { book, writtenChapterTitles } = await readBookForOutline(db, uid, input.bookId);
  const prompt = buildOutlinePrompt({ synopsis: input.synopsis, book, writtenChapterTitles });
  const outline = await generateValidatedOutline(model, prompt);

  // Due chiamate concorrenti con lo stesso requestId: vince la prima scritta,
  // l'altra restituisce quella (la risposta resta identica per il client).
  const doc = await db.runTransaction<OutlineRegistryDoc>(async (tx) => {
    const snap = await tx.get(registryRef);
    if (snap.exists) {
      const existing = outlineRegistryDocSchema.safeParse(snap.data());
      if (!existing.success || existing.data.bookId !== input.bookId) {
        throw new HttpsError('already-exists', 'requestId già usato per un’altra scaletta.');
      }
      return existing.data;
    }
    const fresh: OutlineRegistryDoc = {
      schemaVersion: 1,
      bookId: input.bookId,
      model: model.modelName,
      promptVersion: OUTLINE_PROMPT_VERSION,
      outline,
      createdAt: now(),
    };
    tx.set(registryRef, fresh);
    return fresh;
  });

  return toResponse(input.requestId, doc);
}

/** Handler della callable: auth + validazione input, poi runGenerateOutline. */
export function createGenerateOutlineHandler(
  deps: GenerateOutlineDeps,
): (request: CallableRequest<unknown>) => Promise<GenerateOutlineResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Accesso richiesto.');
    }
    const parsed = generateOutlineInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Attesi { bookId, synopsis, requestId }.');
    }
    return runGenerateOutline(deps, uid, parsed.data);
  };
}
