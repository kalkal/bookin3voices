// Callable `exportBackup(bookId?, requestId)`: backup
// Markdown del testo grezzo — un file per capitolo (frontmatter con
// titolo/ordine/stato/parole) più un indice per libro, consegnati come zip in
// base64. Senza bookId si esporta TUTTA la biblioteca: è la via d'uscita
// indipendente da Firebase/Gemini. Storage non è attivo nell'MVP
// (piano Spark): come per exportBook il file torna nella risposta; la
// variante Storage per backup oltre il tetto callable è annotata come lavoro futuro.
//
// Idempotenza: requestId = id del documento
// users/{uid}/exports/{requestId}; un retry riusa il registro (stessa
// createdAt) e rigenera gli stessi byte (date dello zip fissate a createdAt).

import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import JSZip from 'jszip';

import {
  backupZipFileName,
  bookFolderName,
  bookIndexMarkdown,
  chapterFileName,
  chapterMarkdown,
} from './markdown';
import {
  backupRegistryDocSchema,
  bookBackupDocSchema,
  chapterBackupDocSchema,
  exportBackupInputSchema,
  type BookForBackup,
  type ExportBackupInput,
  type ExportBackupResponse,
} from './types';

/**
 * Tetto sullo zip PRIMA della codifica base64: 7 MiB × 4/3 ≈ 9,3 MB, sotto il
 * limite di risposta delle callable (~10 MB). Iniettabile nei test.
 */
export const DEFAULT_MAX_ZIP_BYTES = 7 * 1024 * 1024;

export interface ExportBackupDeps {
  db: Firestore;
  /** Orologio iniettabile nei test; default Date.now. */
  now?: () => number;
  /** Tetto sui byte dello zip; default DEFAULT_MAX_ZIP_BYTES. */
  maxZipBytes?: number;
}

async function readBookChapters(
  db: Firestore,
  uid: string,
  bookId: string,
): Promise<BookForBackup['chapters']> {
  const chaptersSnap = await db
    .collection(`users/${uid}/books/${bookId}/chapters`)
    .orderBy('order')
    .get();
  return chaptersSnap.docs.map((doc) => {
    const parsed = chapterBackupDocSchema.safeParse(doc.data());
    if (!parsed.success) {
      throw new HttpsError('failed-precondition', `Capitolo ${doc.id} non valido per il backup.`);
    }
    return parsed.data;
  });
}

/**
 * Legge i libri da salvare: uno solo se `bookId` è indicato, altrimenti tutti.
 * A differenza dell'export un libro SENZA capitoli non è un errore: il
 * backup non deve fallire perché un libro è appena nato (compare col solo
 * indice). Errore solo se non c'è proprio nulla da salvare.
 */
async function readBooksForBackup(
  db: Firestore,
  uid: string,
  bookId: string | undefined,
): Promise<BookForBackup[]> {
  const booksRef = db.collection(`users/${uid}/books`);

  const bookDocs =
    bookId === undefined
      ? (await booksRef.orderBy('title').get()).docs
      : await (async () => {
          const snap = await booksRef.doc(bookId).get();
          if (!snap.exists) {
            throw new HttpsError('not-found', 'Libro inesistente.');
          }
          return [snap];
        })();

  if (bookDocs.length === 0) {
    throw new HttpsError('failed-precondition', 'Nessun libro da salvare.');
  }

  return Promise.all(
    bookDocs.map(async (doc) => {
      const parsed = bookBackupDocSchema.safeParse(doc.data());
      if (!parsed.success) {
        throw new HttpsError('failed-precondition', `Libro ${doc.id} non valido per il backup.`);
      }
      return { ...parsed.data, chapters: await readBookChapters(db, uid, doc.id) };
    }),
  );
}

/**
 * Riserva (o riusa) il registro del backup in transazione, come in
 * exportBook: primo giro crea il documento, un retry con lo stesso requestId
 * riusa createdAt, lo stesso requestId su una richiesta DIVERSA è un errore.
 */
async function reserveBackup(
  db: Firestore,
  uid: string,
  input: ExportBackupInput,
  now: () => number,
): Promise<number> {
  const registryRef = db.doc(`users/${uid}/exports/${input.requestId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(registryRef);
    if (snap.exists) {
      const existing = backupRegistryDocSchema.safeParse(snap.data());
      if (!existing.success || existing.data.bookId !== (input.bookId ?? null)) {
        throw new HttpsError('already-exists', 'requestId già usato per un altro export.');
      }
      return existing.data.createdAt;
    }
    const createdAt = now();
    tx.set(registryRef, {
      schemaVersion: 1,
      format: 'backup-md',
      bookId: input.bookId ?? null,
      storagePath: null, // MVP senza Storage
      createdAt,
    });
    return createdAt;
  });
}

/** Zip deterministico: date dei file fissate a createdAt, ordine stabile. */
async function buildZip(books: BookForBackup[], generatedAt: Date): Promise<Buffer> {
  const zip = new JSZip();
  const usedFolders = new Set<string>();
  for (const book of books) {
    const folder = bookFolderName(book.title, usedFolders);
    const fileNames = book.chapters.map((chapter, index) =>
      chapterFileName(index + 1, book.chapters.length, chapter.title),
    );
    zip.file(`${folder}/indice.md`, bookIndexMarkdown(book, fileNames, generatedAt), {
      date: generatedAt,
    });
    book.chapters.forEach((chapter, index) => {
      zip.file(`${folder}/${fileNames[index]}`, chapterMarkdown(index + 1, chapter), {
        date: generatedAt,
      });
    });
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

/** Cuore della callable, testabile direttamente contro l'emulatore Firestore. */
export async function runExportBackup(
  deps: ExportBackupDeps,
  uid: string,
  input: ExportBackupInput,
): Promise<ExportBackupResponse> {
  const { db, now = Date.now, maxZipBytes = DEFAULT_MAX_ZIP_BYTES } = deps;

  const books = await readBooksForBackup(db, uid, input.bookId);
  const createdAt = await reserveBackup(db, uid, input, now);

  const buffer = await buildZip(books, new Date(createdAt));
  const registryRef = db.doc(`users/${uid}/exports/${input.requestId}`);

  if (buffer.length > maxZipBytes) {
    // il libro è cresciuto oltre il tetto della risposta callable: niente
    // registro orfano, e il messaggio indica la strada (variante Storage)
    await registryRef.delete();
    throw new HttpsError(
      'resource-exhausted',
      'Il backup supera il limite di risposta (~10 MB): serve la variante su Storage.',
    );
  }

  const singleBook = input.bookId === undefined ? undefined : books[0];
  const fileName = backupZipFileName(singleBook?.title ?? null, new Date(createdAt));
  await registryRef.set({ fileName, size: buffer.length }, { merge: true });

  return {
    exportId: input.requestId,
    fileName,
    mimeType: 'application/zip',
    base64: buffer.toString('base64'),
    size: buffer.length,
    createdAt,
    bookCount: books.length,
  };
}

/** Handler della callable: auth + validazione input, poi runExportBackup. */
export function createExportBackupHandler(
  deps: ExportBackupDeps,
): (request: CallableRequest<unknown>) => Promise<ExportBackupResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Accesso richiesto.');
    }
    const parsed = exportBackupInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Attesi { bookId?, requestId }.');
    }
    return runExportBackup(deps, uid, parsed.data);
  };
}
