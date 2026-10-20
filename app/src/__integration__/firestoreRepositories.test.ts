/**
 * Integration test of the Firestore repositories against the EMULATOR
 * (never real projects), with the repo's REAL RULES (firestore.rules):
 * besides the repositories' behavior, this checks that every write they make
 * respects the rules' shape validations (schemaVersion on create/update).
 * The demo-* projectId guarantees that no call can reach the cloud.
 *
 * It also covers the offline → sync check: the network is "switched off" with
 * the SDK's disableNetwork() — the only sensible way in a test — and back on
 * with enableNetwork(), checking that the queued writes arrive.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  disableNetwork,
  doc,
  enableNetwork,
  getDoc,
  setDoc,
  waitForPendingWrites,
  type Firestore,
} from 'firebase/firestore';

import { FirestoreBookRepository } from '../features/books/FirestoreBookRepository';
import type { Book } from '../features/books/types';
import { FirestoreChapterRepository } from '../features/chapters/FirestoreChapterRepository';
import type { Chapter, ChapterSummary } from '../features/chapters/types';

const PROJECT_ID = 'demo-bookvoice-app';
const UID = 'jane-test';

// The repo's real rules (root): the repositories must coexist with them.
const RULES = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');

function emulatorHostAndPort(): { host: string; port: number } {
  const fromEnv = process.env.FIRESTORE_EMULATOR_HOST;
  if (fromEnv !== undefined && fromEnv.includes(':')) {
    const [host, port] = fromEnv.split(':');
    return { host, port: Number(port) };
  }
  return { host: '127.0.0.1', port: 8080 };
}

let env: RulesTestEnvironment;
let db: Firestore;

/** Waits for a condition on the observe* streams to become true. */
function waitUntil<T>(
  subscribe: (onChange: (value: T) => void) => () => void,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for: ${label}`));
    }, timeoutMs);
    const unsubscribe = subscribe((value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    });
  });
}

function makeRepos(onWriteError?: (error: Error) => void) {
  const bookRepository = new FirestoreBookRepository({ db, uid: UID, onWriteError });
  const chapterRepository = new FirestoreChapterRepository({ db, uid: UID, onWriteError });
  return { bookRepository, chapterRepository };
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...emulatorHostAndPort(), rules: RULES },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  // a NEW instance for every test: the Firestore client accumulates state (streams,
  // backoff after errors) and on slow CI runners a shared instance made the
  // reads of later tests hang
  db = env.authenticatedContext(UID).firestore() as unknown as Firestore;
});

afterEach(async () => {
  // no background writes straddling the next test's clearFirestore
  await waitForPendingWrites(db).catch(() => {});
});

afterAll(async () => {
  await env.cleanup();
});

describe('FirestoreBookRepository', () => {
  it('createBook writes a schema-conforming document and observeBooks emits it', async () => {
    const { bookRepository } = makeRepos();
    const created = await bookRepository.createBook({ title: 'Le arnie del mulino' });
    expect(created).toMatchObject({
      title: 'Le arnie del mulino',
      wordCount: 0,
      chapterCount: 0,
      status: 'draft',
      language: 'it',
    });

    const books = await waitUntil<Book[]>(
      (cb) => bookRepository.observeBooks(cb),
      (list) => list.length === 1,
      'observeBooks emits the created book',
    );
    expect(books[0]).toMatchObject({ id: created.id, title: 'Le arnie del mulino' });

    await waitForPendingWrites(db);
    const fetched = await bookRepository.getBook(created.id);
    expect(fetched).toMatchObject({ schemaVersion: 1, title: 'Le arnie del mulino' });
    expect(typeof fetched?.createdAt).toBe('number');
  });

  it('updateBook updates the metadata and deleteBook also removes the chapters', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Racconti del mulino' });
    const chapter = await chapterRepository.createChapter(book.id, { title: 'Il pontile' });
    await bookRepository.updateBook(book.id, { status: 'refined', genre: 'Raccolta' });
    await waitForPendingWrites(db);
    expect(await bookRepository.getBook(book.id)).toMatchObject({
      status: 'refined',
      genre: 'Raccolta',
    });

    await bookRepository.deleteBook(book.id);
    await waitForPendingWrites(db);
    expect(await bookRepository.getBook(book.id)).toBeNull();
    expect(
      await chapterRepository.getChapter({ bookId: book.id, chapterId: chapter.id }),
    ).toBeNull();
  });

  it('a non-conforming document: observeBooks skips it, getBook throws', async () => {
    const { bookRepository } = makeRepos();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const good = await bookRepository.createBook({ title: 'Libro sano' });
      await waitForPendingWrites(db);
      await setDoc(doc(db, 'users', UID, 'books', 'rotto'), {
        schemaVersion: 1,
        title: 'Senza gli altri campi',
        updatedAt: new Date(),
      });

      const books = await waitUntil<Book[]>(
        (cb) => bookRepository.observeBooks(cb),
        (list) => list.length === 1,
        'observeBooks skips the broken document',
      );
      expect(books[0].id).toBe(good.id);
      await expect(bookRepository.getBook('rotto')).rejects.toThrow(/does not match the schema/);
    } finally {
      warn.mockRestore();
    }
  });

  it('reconcileCounters corregge contatori derivati', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Contatori storti' });
    const chapter = await chapterRepository.createChapter(book.id, { title: 'Uno' });
    await chapterRepository.loadRawText({ bookId: book.id, chapterId: chapter.id });
    await chapterRepository.saveRawText(
      { bookId: book.id, chapterId: chapter.id },
      'cinque parole scritte proprio qui',
    );
    await waitForPendingWrites(db);

    // the counters are corrupted as a session that died offline would do
    await setDoc(
      doc(db, 'users', UID, 'books', book.id),
      { wordCount: 999, chapterCount: 7 },
      { merge: true },
    );
    await bookRepository.reconcileCounters(book.id);
    await waitForPendingWrites(db);
    expect(await bookRepository.getBook(book.id)).toMatchObject({
      wordCount: 5,
      chapterCount: 1,
    });
  });
});

describe('FirestoreChapterRepository', () => {
  it('createChapter appends with increasing order and increments chapterCount', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Le arnie del mulino' });
    const primo = await chapterRepository.createChapter(book.id, { title: 'Le chiavi di casa' });
    const secondo = await chapterRepository.createChapter(book.id, { title: 'La piena del fiume' });
    expect(primo.order).toBe(0);
    expect(secondo.order).toBe(1);

    const chapters = await waitUntil<ChapterSummary[]>(
      (cb) => chapterRepository.observeChapters(book.id, cb),
      (list) => list.length === 2,
      'observeChapters emits the two chapters',
    );
    expect(chapters.map((c) => c.title)).toEqual(['Le chiavi di casa', 'La piena del fiume']);

    await waitForPendingWrites(db);
    expect(await bookRepository.getBook(book.id)).toMatchObject({ chapterCount: 2 });
  });

  it('saveRawText updates wordCount of the chapter and of the book (denormalized)', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Le arnie del mulino' });
    const chapter = await chapterRepository.createChapter(book.id, { title: 'La piena' });
    const ref = { bookId: book.id, chapterId: chapter.id };

    await chapterRepository.saveRawText(ref, 'Il mulino era fermo da tre giorni.');
    await waitForPendingWrites(db);
    expect(await chapterRepository.getChapter(ref)).toMatchObject({
      rawText: 'Il mulino era fermo da tre giorni.',
      wordCount: 7,
    });
    expect(await bookRepository.getBook(book.id)).toMatchObject({ wordCount: 7 });

    // second save: the book receives the DELTA, not the blind sum
    await chapterRepository.saveRawText(ref, 'Il mulino era fermo.');
    await waitForPendingWrites(db);
    expect(await bookRepository.getBook(book.id)).toMatchObject({ wordCount: 4 });
  });

  it('outline: round-trip on create and update, null for chapters without one', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Con scaletta' });
    const outline = { summary: 'Il fiume sale.', beats: ['La ruota', 'La gola'], beatsDone: [] };

    const conOutline = await chapterRepository.createChapter(book.id, {
      title: 'La piena',
      outline,
    });
    const senzaOutline = await chapterRepository.createChapter(book.id, { title: 'Bozza' });
    await waitForPendingWrites(db);

    expect(
      await chapterRepository.getChapter({ bookId: book.id, chapterId: conOutline.id }),
    ).toMatchObject({ outline, status: 'draft' });
    expect(
      await chapterRepository.getChapter({ bookId: book.id, chapterId: senzaOutline.id }),
    ).toMatchObject({ outline: null });

    // the additive merge fills an empty slot: title + outline via updateChapter;
    // non-empty beatsDone: round-trip also of the beats ticked during dictation
    const nuova = { summary: 'Tutto cambia.', beats: ['Il patto'], beatsDone: [0] };
    await chapterRepository.updateChapter(
      { bookId: book.id, chapterId: senzaOutline.id },
      { title: 'Il patto', outline: nuova },
    );
    await waitForPendingWrites(db);
    expect(
      await chapterRepository.getChapter({ bookId: book.id, chapterId: senzaOutline.id }),
    ).toMatchObject({ title: 'Il patto', outline: nuova });
  });

  it('reorderChapters rewrites the orders 0..n-1 and rejects partial reorders', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Riordino' });
    const a = await chapterRepository.createChapter(book.id, { title: 'A' });
    const b = await chapterRepository.createChapter(book.id, { title: 'B' });
    const c = await chapterRepository.createChapter(book.id, { title: 'C' });
    await waitForPendingWrites(db);

    await chapterRepository.reorderChapters(book.id, [c.id, a.id, b.id]);
    const chapters = await waitUntil<ChapterSummary[]>(
      (cb) => chapterRepository.observeChapters(book.id, cb),
      (list) => list.length === 3 && list[0].id === c.id,
      'observeChapters emits the new order',
    );
    expect(chapters.map((ch) => [ch.title, ch.order])).toEqual([
      ['C', 0],
      ['A', 1],
      ['B', 2],
    ]);

    await expect(chapterRepository.reorderChapters(book.id, [a.id, b.id])).rejects.toThrow(
      /Riordino non totale/,
    );
  });

  it('updateChapter cambia stato/titolo; deleteChapter aggiorna i contatori', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Stati' });
    const chapter = await chapterRepository.createChapter(book.id, { title: 'Bozza' });
    const ref = { bookId: book.id, chapterId: chapter.id };
    await chapterRepository.saveRawText(ref, 'tre parole qui');
    await chapterRepository.updateChapter(ref, { status: 'refined', title: 'Rifinito' });
    await waitForPendingWrites(db);
    expect(await chapterRepository.getChapter(ref)).toMatchObject({
      status: 'refined',
      title: 'Rifinito',
      wordCount: 3,
    });

    await chapterRepository.deleteChapter(ref);
    await waitForPendingWrites(db);
    expect(await chapterRepository.getChapter(ref)).toBeNull();
    expect(await bookRepository.getBook(book.id)).toMatchObject({
      chapterCount: 0,
      wordCount: 0,
    });
  });

  it('loadRawText tells a never-saved chapter (null) from a broken document (error)', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Vuoto vs rotto' });
    expect(await chapterRepository.loadRawText({ bookId: book.id, chapterId: 'mai-visto' })).toBe(
      null,
    );

    await setDoc(doc(db, 'users', UID, 'books', book.id, 'chapters', 'rotto'), {
      schemaVersion: 1,
      rawText: 42,
    });
    await expect(
      chapterRepository.loadRawText({ bookId: book.id, chapterId: 'rotto' }),
    ).rejects.toThrow(/does not match the schema/);
  });
});

describe('offline → sync check', () => {
  it('changes made with the network off sync on reconnection', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Le arnie del mulino' });
    const chapter = await chapterRepository.createChapter(book.id, { title: 'La piena' });
    const ref = { bookId: book.id, chapterId: chapter.id };
    await chapterRepository.saveRawText(ref, 'Prima riga dettata online.');
    await waitForPendingWrites(db);

    // ── network OFF (the SDK's equivalent of airplane mode) ──
    await disableNetwork(db);
    await chapterRepository.saveRawText(ref, 'Prima riga dettata online. Poi il buio.');

    // the app keeps seeing the updated text (latency compensation):
    // observe emits from the local cache even without network
    const visto = await waitUntil<Chapter>(
      (cb) => chapterRepository.observeChapter(ref, (c) => c !== null && cb(c)),
      (c) => c.rawText.includes('Poi il buio.'),
      'observeChapter emits the offline change',
    );
    expect(visto.wordCount).toBe(7);

    // ── network ON: the write queue reaches the emulator ──
    await enableNetwork(db);
    await waitForPendingWrites(db);

    // check from ANOTHER client (new context = no shared cache):
    // the text is really on the server, not just in the first one's cache
    const altroClient = env.authenticatedContext(UID).firestore() as unknown as Firestore;
    const snapshot = await getDoc(
      doc(altroClient, 'users', UID, 'books', book.id, 'chapters', chapter.id),
    );
    expect(snapshot.data()?.rawText).toBe('Prima riga dettata online. Poi il buio.');
  });
});

describe('per-user rules (the repo’s firestore.rules)', () => {
  it('another user cannot read Jane’s books', async () => {
    const { bookRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Privato' });
    await waitForPendingWrites(db);
    const intruso = env.authenticatedContext('altro-utente').firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(intruso, 'users', UID, 'books', book.id)));
  });
});
