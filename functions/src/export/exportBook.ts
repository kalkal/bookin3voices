// Callable `exportBook(bookId, format, requestId)`: legge libro e
// capitoli da Firestore (solo il rawText finale — i suggerimenti pending si
// IGNORANO deliberatamente), compone frontespizio+indice+capitoli e
// restituisce il file al client. Storage non è attivo nell'MVP (piano Spark):
// il file torna in base64 nella risposta e l'app lo salva in locale; la
// variante Storage+URL firmato è annotata come lavoro futuro.
//
// Idempotenza: il requestId è l'id del documento
// users/{uid}/exports/{requestId} — un retry di rete riusa il registro
// esistente (stessa createdAt) invece di creare un secondo export.

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
  /** Orologio iniettabile nei test; default Date.now. */
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
    throw new HttpsError('not-found', 'Libro inesistente.');
  }
  const bookParsed = bookExportDocSchema.safeParse(bookSnap.data());
  if (!bookParsed.success) {
    throw new HttpsError('failed-precondition', 'Documento libro non valido per l’export.');
  }

  const chaptersSnap = await bookRef.collection('chapters').orderBy('order').get();
  const chapters = chaptersSnap.docs.map((doc) => {
    const parsed = chapterExportDocSchema.safeParse(doc.data());
    if (!parsed.success) {
      throw new HttpsError('failed-precondition', `Capitolo ${doc.id} non valido per l’export.`);
    }
    return { title: parsed.data.title, rawText: parsed.data.rawText };
  });

  if (chapters.length === 0) {
    throw new HttpsError('failed-precondition', 'Il libro non ha capitoli da esportare.');
  }

  return { ...bookParsed.data, chapters };
}

/**
 * Riserva (o riusa) il registro dell'export in transazione: alla prima
 * richiesta crea users/{uid}/exports/{requestId}, un retry con lo stesso
 * requestId riusa createdAt; lo stesso requestId su un export DIVERSO è un
 * errore del client.
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
        throw new HttpsError('already-exists', 'requestId già usato per un altro export.');
      }
      return existing.data.createdAt;
    }
    const createdAt = now();
    tx.set(registryRef, {
      schemaVersion: 1,
      bookId: input.bookId,
      format: input.format,
      storagePath: null, // MVP senza Storage
      createdAt,
    });
    return createdAt;
  });
}

/** Cuore della callable, testabile direttamente contro l'emulatore Firestore. */
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

/** Handler della callable: auth + validazione input, poi runExportBook. */
export function createExportBookHandler(
  deps: ExportBookDeps,
): (request: CallableRequest<unknown>) => Promise<ExportBookResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Accesso richiesto.');
    }
    const parsed = exportBookInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        'Attesi { bookId, format: epub|docx, requestId, strict? }.',
      );
    }
    return runExportBook(deps, uid, parsed.data);
  };
}
