// Callable `exportBackup(bookId?, requestId)`: Markdown backup of the raw
// text - one file per chapter (frontmatter with title/order/status/word count)
// plus one index per book, delivered as a base64 zip. Without bookId the WHOLE
// library is exported: it is the exit route that is independent of
// Firebase/Gemini. Storage is not enabled in the MVP (Spark plan): as with
// exportBook, the file is returned in the response; the Storage variant for
// backups above the callable limit is noted as future work.
//
// Idempotency: requestId = id of the document users/{uid}/exports/{requestId};
// a retry reuses the registry entry (same createdAt) and regenerates the same
// bytes (zip dates are pinned to createdAt).

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
 * Cap on the zip BEFORE base64 encoding: 7 MiB x 4/3 ~ 9.3 MB, under the
 * callable response limit (~10 MB). Injectable in tests.
 */
export const DEFAULT_MAX_ZIP_BYTES = 7 * 1024 * 1024;

export interface ExportBackupDeps {
  db: Firestore;
  /** Clock, injectable in tests; defaults to Date.now. */
  now?: () => number;
  /** Cap on zip bytes; defaults to DEFAULT_MAX_ZIP_BYTES. */
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
      throw new HttpsError('failed-precondition', `Chapter ${doc.id} is not valid for backup.`);
    }
    return parsed.data;
  });
}

/**
 * Reads the books to back up: just one if `bookId` is given, otherwise all.
 * Unlike export, a book WITHOUT chapters is not an error: the backup must not
 * fail because a book was just created (it appears with its index only).
 * It is an error only if there is nothing at all to back up.
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
            throw new HttpsError('not-found', 'Book not found.');
          }
          return [snap];
        })();

  if (bookDocs.length === 0) {
    throw new HttpsError('failed-precondition', 'No books to back up.');
  }

  return Promise.all(
    bookDocs.map(async (doc) => {
      const parsed = bookBackupDocSchema.safeParse(doc.data());
      if (!parsed.success) {
        throw new HttpsError('failed-precondition', `Book ${doc.id} is not valid for backup.`);
      }
      return { ...parsed.data, chapters: await readBookChapters(db, uid, doc.id) };
    }),
  );
}

/**
 * Reserves (or reuses) the backup registry entry in a transaction, as in
 * exportBook: the first call creates the document, a retry with the same
 * requestId reuses createdAt, the same requestId on a DIFFERENT request is an
 * error.
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
        throw new HttpsError('already-exists', 'requestId already used for another export.');
      }
      return existing.data.createdAt;
    }
    const createdAt = now();
    tx.set(registryRef, {
      schemaVersion: 1,
      format: 'backup-md',
      bookId: input.bookId ?? null,
      storagePath: null, // MVP without Storage
      createdAt,
    });
    return createdAt;
  });
}

/** Deterministic zip: file and folder dates pinned to createdAt, stable order. */
async function buildZip(books: BookForBackup[], generatedAt: Date): Promise<Buffer> {
  const zip = new JSZip();
  const usedFolders = new Set<string>();
  for (const book of books) {
    const folder = bookFolderName(book.title, usedFolders);
    const fileNames = book.chapters.map((chapter, index) =>
      chapterFileName(index + 1, book.chapters.length, chapter.title),
    );
    // Explicit folder entry: the one JSZip creates implicitly would carry
    // the current time and break byte-for-byte idempotency on retry.
    zip.file(`${folder}/`, null, { dir: true, date: generatedAt });
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

/** Core of the callable, testable directly against the Firestore emulator. */
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
    // the book outgrew the callable response cap: no orphaned registry entry,
    // and the message points to the way forward (Storage variant)
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

/** Callable handler: auth + input validation, then runExportBackup. */
export function createExportBackupHandler(
  deps: ExportBackupDeps,
): (request: CallableRequest<unknown>) => Promise<ExportBackupResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const parsed = exportBackupInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Expected { bookId?, requestId }.');
    }
    return runExportBackup(deps, uid, parsed.data);
  };
}
