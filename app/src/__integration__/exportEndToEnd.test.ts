/**
 * Export end-to-end on the FULL Emulator Suite (auth + firestore +
 * functions: never real projects): the path is exactly that of the real
 * app, using the app's code.
 *
 *   anonymous sign-in (auth) → FirestoreBookRepository/FirestoreChapterRepository
 *   create book and chapters (real rules) → CallableBookExportService calls the
 *   exportBook callable (functions emulator) → the file comes back as base64 →
 *   it is written to disk and validated with EPUBCheck.
 *
 * Prerequisites: `firebase emulators:exec --only auth,firestore,functions` with
 * functions/ already built (npm --prefix functions run build) and EPUBCheck
 * reachable (see ./epubcheck.ts). The trial upload to KDP stays manual (the
 * export's done criterion, final manual step).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

import { FirestoreBookRepository } from '../features/books/FirestoreBookRepository';
import { FirestoreChapterRepository } from '../features/chapters/FirestoreChapterRepository';
import { CallableBookExportService } from '../features/export/CallableBookExportService';
import { FirestorePendingSuggestionsRepository } from '../features/export/FirestorePendingSuggestionsRepository';
import { base64ToUint8Array } from '../features/export/base64';
import { runEpubcheck } from './epubcheck';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error('These tests run ONLY against the Emulator Suite (firebase emulators:exec).');
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-app';
const EMULATOR_HOST = '127.0.0.1';

jest.setTimeout(120000);

describe('export end-to-end (app → functions emulator → EPUBCheck)', () => {
  let app: FirebaseApp;
  let db: Firestore;
  let uid: string;

  beforeAll(async () => {
    app = initializeApp({ apiKey: 'emulator-fake-api-key', projectId: PROJECT_ID }, 'export-e2e');
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    db = getFirestore(app);
    connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
    const functions = getFunctions(app);
    connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
    uid = (await signInAnonymously(auth)).user.uid;
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it('generates from the app an EPUB that passes EPUBCheck, ignoring pending', async () => {
    // 1. book and chapters created with the app's real code (real rules)
    const books = new FirestoreBookRepository({ db, uid });
    const chapters = new FirestoreChapterRepository({ db, uid });
    const book = await books.createBook({
      title: 'Il faro di Levante',
      author: 'Jane Doe',
      language: 'it',
    });
    await books.updateBook(book.id, {
      description: 'Nora Ferrandi eredita un faro e il segreto che custodiva.',
    });
    const capitolo1 = await chapters.createChapter(book.id, { title: 'Il ritorno' });
    await chapters.saveRawText(
      { bookId: book.id, chapterId: capitolo1.id },
      'Il traghetto attraccò con mezz’ora di ritardo.\nMarta scese sulla banchina — «finalmente», pensò.',
    );
    const capitolo2 = await chapters.createChapter(book.id, { title: 'Il registro' });
    await chapters.saveRawText(
      { bookId: book.id, chapterId: capitolo2.id },
      'Date, orari & coordinate <in codice>.',
    );

    // 2. a pending suggestion: the pre-export warning counts it,
    //    the export ignores it
    await setDoc(
      doc(db, 'users', uid, 'books', book.id, 'chapters', capitolo1.id, 'suggestions', 'sug-1'),
      {
        id: 'sug-1',
        kind: 'style',
        span: { from: 0, to: 12 },
        original: 'Il traghetto',
        proposals: ['PROPOSTA-PENDING-CHE-NON-DEVE-ENTRARE'],
        rationale: 'prova',
        state: 'pending',
        textHash: 'hash-di-prova',
      },
    );
    const pending = new FirestorePendingSuggestionsRepository({ db, uid });
    expect(await pending.countPending(book.id)).toBe(1);

    // 3. export through the callable, as the Export tab would
    const exportService = new CallableBookExportService({ functions: getFunctions(app) });
    const file = await exportService.exportBook({
      bookId: book.id,
      format: 'epub',
      requestId: 'e2e-epub-1',
    });

    expect(file.fileName).toBe('il-faro-di-levante.epub');
    expect(file.mimeType).toBe('application/epub+zip');
    const bytes = base64ToUint8Array(file.base64);
    expect(bytes.length).toBe(file.size);

    const text = Buffer.from(bytes).toString('utf8');
    expect(text).not.toContain('PROPOSTA-PENDING-CHE-NON-DEVE-ENTRARE');

    // 4. EPUBCheck green: the export's done criterion
    const dir = mkdtempSync(join(tmpdir(), 'bookvoice-e2e-'));
    const epubPath = join(dir, file.fileName);
    writeFileSync(epubPath, bytes);
    const result = runEpubcheck(epubPath);
    expect(`${result.status}\n${result.output}`).toMatch(/^0\n/);
  });

  it('the callable is idempotent also through the SDK (same requestId)', async () => {
    const books = new FirestoreBookRepository({ db, uid });
    const chapters = new FirestoreChapterRepository({ db, uid });
    const book = await books.createBook({ title: 'Doppio invio' });
    const capitolo = await chapters.createChapter(book.id, { title: 'Unico' });
    await chapters.saveRawText({ bookId: book.id, chapterId: capitolo.id }, 'Testo breve.');

    const exportService = new CallableBookExportService({ functions: getFunctions(app) });
    const request = { bookId: book.id, format: 'epub' as const, requestId: 'e2e-retry-1' };
    const first = await exportService.exportBook(request);
    const retry = await exportService.exportBook(request);
    expect(retry.exportId).toBe(first.exportId);
    expect(retry.createdAt).toBe(first.createdAt);
  });
});
