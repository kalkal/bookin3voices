// Callable `exportBook(bookId, format, requestId)`: reads the book and its
// chapters from Firestore (only the final rawText - pending suggestions are
// deliberately IGNORED), composes title page + index + chapters and returns
// the file to the client. Storage is not enabled in the MVP (Spark plan): the
// file is returned as base64 in the response and the app saves it locally; the
// Storage + signed URL variant is noted as future work.
//
// Idempotency: the requestId is the id of the document
// users/{uid}/exports/{requestId} - a network retry reuses the existing
// registry entry (same createdAt) instead of creating a second export.

import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import { exportFileName } from './compose';
import { createExporter } from './exporterFactory';
import { runKdpPreflight } from './kdpPreflight';
import {
  bookExportDocSchema,
  chapterExportDocSchema,
  exportBookInputSchema,
  exportRegistryDocSchema,
  type BookForExport,
  type ExportBookInput,
  type ExportBookResponse,
} from './types';

export interface ExportBookDeps {
  db: Firestore;
  /** Clock, injectable in tests; defaults to Date.now. */
  now?: () => number;
}

async function readBookForExport(
  db: Firestore,
  uid: string,
  bookId: string,
): Promise<BookForExport> {
  const bookRef = db.doc(`users/${uid}/books/${bookId}`);
  const bookSnap = await bookRef.get();
  if (!bookSnap.exists) {
    throw new HttpsError('not-found', 'Book not found.');
  }
  const bookParsed = bookExportDocSchema.safeParse(bookSnap.data());
  if (!bookParsed.success) {
    throw new HttpsError('failed-precondition', 'Book document is not valid for export.');
  }

  const chaptersSnap = await bookRef.collection('chapters').orderBy('order').get();
  const chapters = chaptersSnap.docs.map((doc) => {
    const parsed = chapterExportDocSchema.safeParse(doc.data());
    if (!parsed.success) {
      throw new HttpsError('failed-precondition', `Chapter ${doc.id} is not valid for export.`);
    }
    return { title: parsed.data.title, rawText: parsed.data.rawText };
  });

  if (chapters.length === 0) {
    throw new HttpsError('failed-precondition', 'Il libro non ha capitoli da esportare.');
  }

  return { ...bookParsed.data, chapters };
}

/**
 * Reserves (or reuses) the export registry entry in a transaction: the first
 * request creates users/{uid}/exports/{requestId}, a retry with the same
 * requestId reuses createdAt; the same requestId on a DIFFERENT export is a
 * client error.
 */
async function reserveExport(
  db: Firestore,
  uid: string,
  input: ExportBookInput,
  now: () => number,
): Promise<number> {
  const registryRef = db.doc(`users/${uid}/exports/${input.requestId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(registryRef);
    if (snap.exists) {
      const existing = exportRegistryDocSchema.safeParse(snap.data());
      if (
        !existing.success ||
        existing.data.bookId !== input.bookId ||
        existing.data.format !== input.format
      ) {
        throw new HttpsError('already-exists', 'requestId already used for another export.');
      }
      return existing.data.createdAt;
    }
    const createdAt = now();
    tx.set(registryRef, {
      schemaVersion: 1,
      bookId: input.bookId,
      format: input.format,
      storagePath: null, // MVP without Storage
      createdAt,
    });
    return createdAt;
  });
}

/** Core of the callable, testable directly against the Firestore emulator. */
export async function runExportBook(
  deps: ExportBookDeps,
  uid: string,
  input: ExportBookInput,
): Promise<ExportBookResponse> {
  const { db, now = Date.now } = deps;

  const book = await readBookForExport(db, uid, input.bookId);

  // KDP preflight: always reported; blocks only on request (a draft with an
  // empty chapter can still be exported for proofreading)
  const preflight = runKdpPreflight(book);
  if (input.strict === true && !preflight.ok) {
    throw new HttpsError(
      'failed-precondition',
      `KDP preflight failed: ${preflight.errors.map((e) => e.message).join(' ')}`,
      { preflight },
    );
  }

  const createdAt = await reserveExport(db, uid, input, now);

  const exporter = createExporter(input.format);
  const buffer = await exporter.render(book, new Date(createdAt));
  const fileName = exportFileName(book.title, exporter.extension);

  await db
    .doc(`users/${uid}/exports/${input.requestId}`)
    .set({ fileName, size: buffer.length }, { merge: true });

  return {
    exportId: input.requestId,
    format: input.format,
    fileName,
    mimeType: exporter.mimeType,
    base64: buffer.toString('base64'),
    size: buffer.length,
    createdAt,
    preflight,
  };
}

/** Callable handler: auth + input validation, then runExportBook. */
export function createExportBookHandler(
  deps: ExportBookDeps,
): (request: CallableRequest<unknown>) => Promise<ExportBookResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const parsed = exportBookInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        'Expected { bookId, format: epub|docx, requestId, strict? }.',
      );
    }
    return runExportBook(deps, uid, parsed.data);
  };
}
