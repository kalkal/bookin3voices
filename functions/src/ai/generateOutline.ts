// Callable `generateOutline(bookId, synopsis, requestId)`:
// synopsis → AI model (structured output) → chapter outline
// {title, summary, beats[]} VALIDATED with Zod. The callable does NOT write
// chapters: it returns the proposal; the corkboard preview and the additive
// merge (which never touches chapters that have text) belong to the app.
//
// Idempotency: the requestId is the id of the document
// users/{uid}/outlines/{requestId}; a network retry reuses the outline already
// generated (same response, no second call to the model).

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { enforceUsageLimit, type UsageAction, type UsageLimit } from '../usage/rateLimit';
import { buildOutlinePrompt, OUTLINE_PROMPT_VERSION, outlineStyleOf } from './outlinePrompt';
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
  /** Clock, injectable in tests; defaults to Date.now. */
  now?: () => number;
  /** Daily usage caps; defaults to DEFAULT_USAGE_LIMITS. */
  usageLimits?: Record<UsageAction, UsageLimit>;
}

/**
 * Cleans the candidate BEFORE validation: texts are trimmed and empty beats
 * dropped. Deterministic structural hygiene only; everything else (limits,
 * missing fields, types) is left to the Zod schema: a candidate that fails
 * after cleaning is non-conforming output.
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

/** Reads the book (prompt context) or throws descriptive errors. */
async function readBookForOutline(db: Firestore, uid: string, bookId: string) {
  const bookRef = db.doc(`users/${uid}/books/${bookId}`);
  const bookSnap = await bookRef.get();
  if (!bookSnap.exists) {
    throw new HttpsError('not-found', 'Book not found.');
  }
  const parsed = bookForOutlineSchema.safeParse(bookSnap.data());
  if (!parsed.success) {
    throw new HttpsError('failed-precondition', 'Book document is not valid for the outline.');
  }

  // Chapters with text are untouchable context: they enter the prompt as
  // "already written, do not propose again". A malformed chapter blocks the
  // call: a clear error beats an outline built on incomplete context.
  const chaptersSnap = await bookRef.collection('chapters').orderBy('order').get();
  const writtenChapterTitles: string[] = [];
  for (const doc of chaptersSnap.docs) {
    const chapter = chapterForOutlineSchema.safeParse(doc.data());
    if (!chapter.success) {
      throw new HttpsError(
        'failed-precondition',
        `Chapter ${doc.id} is not valid for the outline.`,
      );
    }
    if (chapter.data.rawText.trim() !== '') {
      writtenChapterTitles.push(chapter.data.title);
    }
  }

  return { book: parsed.data, writtenChapterTitles };
}

/** Calls the model with ONE retry on non-conforming output. */
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
      // transport error or unreadable JSON: treated like non-conforming output
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
    lastIssue = parsed.error.issues[0]?.message ?? 'schema not respected';
  }
  throw new HttpsError(
    'unavailable',
    `The model did not produce a valid outline: ${lastIssue.slice(0, 200)}. Try again.`,
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

/** Core of the callable, testable directly against the Firestore emulator. */
export async function runGenerateOutline(
  deps: GenerateOutlineDeps,
  uid: string,
  input: GenerateOutlineInput,
): Promise<GenerateOutlineResponse> {
  const { db, model, now = Date.now, usageLimits } = deps;
  const registryRef = db.doc(`users/${uid}/outlines/${input.requestId}`);

  // Network retry: if the registry document already exists, reuse the saved
  // outline without a second model call. The same requestId on another book is
  // a client error (as in exportBook).
  const existingSnap = await registryRef.get();
  if (existingSnap.exists) {
    const existing = outlineRegistryDocSchema.safeParse(existingSnap.data());
    if (!existing.success || existing.data.bookId !== input.bookId) {
      throw new HttpsError('already-exists', 'requestId already used for another outline.');
    }
    return toResponse(input.requestId, existing.data);
  }

  // Anti-abuse cap: after the idempotency short-circuit (a retry reuses the
  // saved outline, zero budget) and before the call to the Pro model.
  await enforceUsageLimit({ db, uid, action: 'generateOutline', now, limits: usageLimits });

  const { book, writtenChapterTitles } = await readBookForOutline(db, uid, input.bookId);
  const prompt = buildOutlinePrompt({
    synopsis: input.synopsis,
    book,
    style: outlineStyleOf(input.styleId, book.styleProfileId),
    writtenChapterTitles,
  });
  const outline = await generateValidatedOutline(model, prompt);

  // Two concurrent calls with the same requestId: the first write wins and the
  // other returns it (the response stays identical for the client).
  const doc = await db.runTransaction<OutlineRegistryDoc>(async (tx) => {
    const snap = await tx.get(registryRef);
    if (snap.exists) {
      const existing = outlineRegistryDocSchema.safeParse(snap.data());
      if (!existing.success || existing.data.bookId !== input.bookId) {
        throw new HttpsError('already-exists', 'requestId already used for another outline.');
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

/** Callable handler: auth + input validation, then runGenerateOutline. */
export function createGenerateOutlineHandler(
  deps: GenerateOutlineDeps,
): (request: CallableRequest<unknown>) => Promise<GenerateOutlineResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const parsed = generateOutlineInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        'Expected { bookId, synopsis, requestId, styleId? }.',
      );
    }
    return runGenerateOutline(deps, uid, parsed.data);
  };
}
