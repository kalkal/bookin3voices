/**
 * Test d'integrazione dei repository Firestore contro l'EMULATORE
 * (mai progetti reali), con le REGOLE VERE del repo (firestore.rules
 * della fase delle regole Firestore): oltre al comportamento dei repository si verifica così che ogni
 * loro scrittura rispetti le validazioni di forma delle rules (schemaVersion
 * su create/update). Il projectId demo-* garantisce che nessuna chiamata possa
 * raggiungere il cloud.
 *
 * Copre anche la verifica (offline → sync): la rete si "spegne" con
 * disableNetwork() dell'SDK — l'unico modo sensato in un test — e si riaccende
 * con enableNetwork(), controllando che le scritture accodate arrivino.
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

// Le regole vere del repo (root): i repository devono conviverci.
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

/** Attende che una condizione sugli observe* diventi vera. */
function waitUntil<T>(
  subscribe: (onChange: (value: T) => void) => () => void,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout in attesa di: ${label}`));
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
  // istanza NUOVA per ogni test: il client Firestore accumula stato (stream,
  // backoff dopo errori) e sui runner CI lenti un'istanza condivisa faceva
  // appendere a vuoto le letture dei test successivi
  db = env.authenticatedContext(UID).firestore() as unknown as Firestore;
});

afterEach(async () => {
  // niente scritture di fondo a cavallo del clearFirestore del test dopo
  await waitForPendingWrites(db).catch(() => {});
});

afterAll(async () => {
  await env.cleanup();
});

describe('FirestoreBookRepository', () => {
  it('createBook scrive un documento conforme allo schema e observeBooks lo emette', async () => {
    const { bookRepository } = makeRepos();
    const created = await bookRepository.createBook({ title: 'Il custode del faro' });
    expect(created).toMatchObject({
      title: 'Il custode del faro',
      wordCount: 0,
      chapterCount: 0,
      status: 'draft',
      language: 'it',
    });

    const books = await waitUntil<Book[]>(
      (cb) => bookRepository.observeBooks(cb),
      (list) => list.length === 1,
      'observeBooks emette il libro creato',
    );
    expect(books[0]).toMatchObject({ id: created.id, title: 'Il custode del faro' });

    await waitForPendingWrites(db);
    const fetched = await bookRepository.getBook(created.id);
    expect(fetched).toMatchObject({ schemaVersion: 1, title: 'Il custode del faro' });
    expect(typeof fetched?.createdAt).toBe('number');
  });

  it('updateBook aggiorna i metadati e deleteBook porta via anche i capitoli', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Racconti del molo' });
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

  it('un documento non conforme: observeBooks lo salta, getBook lancia', async () => {
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
        'observeBooks salta il documento rotto',
      );
      expect(books[0].id).toBe(good.id);
      await expect(bookRepository.getBook('rotto')).rejects.toThrow(/non conforme/);
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

    // si storpiano i contatori come farebbe una sessione morta offline
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
  it('createChapter accoda con order crescente e incrementa chapterCount', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Il custode del faro' });
    const primo = await chapterRepository.createChapter(book.id, { title: 'Le chiavi di casa' });
    const secondo = await chapterRepository.createChapter(book.id, { title: 'La bassa marea' });
    expect(primo.order).toBe(0);
    expect(secondo.order).toBe(1);

    const chapters = await waitUntil<ChapterSummary[]>(
      (cb) => chapterRepository.observeChapters(book.id, cb),
      (list) => list.length === 2,
      'observeChapters emette i due capitoli',
    );
    expect(chapters.map((c) => c.title)).toEqual(['Le chiavi di casa', 'La bassa marea']);

    await waitForPendingWrites(db);
    expect(await bookRepository.getBook(book.id)).toMatchObject({ chapterCount: 2 });
  });

  it('saveRawText aggiorna wordCount del capitolo e del libro (denormalizzato)', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Il custode del faro' });
    const chapter = await chapterRepository.createChapter(book.id, { title: 'La marea' });
    const ref = { bookId: book.id, chapterId: chapter.id };

    await chapterRepository.saveRawText(ref, 'Il faro era spento da tre giorni.');
    await waitForPendingWrites(db);
    expect(await chapterRepository.getChapter(ref)).toMatchObject({
      rawText: 'Il faro era spento da tre giorni.',
      wordCount: 7,
    });
    expect(await bookRepository.getBook(book.id)).toMatchObject({ wordCount: 7 });

    // secondo salvataggio: il libro riceve il DELTA, non la somma cieca
    await chapterRepository.saveRawText(ref, 'Il faro era spento.');
    await waitForPendingWrites(db);
    expect(await bookRepository.getBook(book.id)).toMatchObject({ wordCount: 4 });
  });

  it('outline: round-trip su create e update, null per i capitoli senza', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Con scaletta' });
    const outline = { summary: 'La marea sale.', beats: ['Il molo', 'La secca'], beatsDone: [] };

    const conOutline = await chapterRepository.createChapter(book.id, {
      title: 'La marea',
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

    // il merge additivo riempie uno slot vuoto: titolo + outline via updateChapter;
    // beatsDone non vuoto: round-trip anche dei beat spuntati in dettatura
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

  it('reorderChapters riscrive gli order 0..n-1 e rifiuta riordini parziali', async () => {
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
      'observeChapters emette il nuovo ordine',
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

  it('loadRawText distingue capitolo mai salvato (null) da documento rotto (errore)', async () => {
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
    ).rejects.toThrow(/non conforme/);
  });
});

describe('verifica offline → sync', () => {
  it('le modifiche fatte a rete spenta si sincronizzano alla riaccensione', async () => {
    const { bookRepository, chapterRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Il custode del faro' });
    const chapter = await chapterRepository.createChapter(book.id, { title: 'La marea' });
    const ref = { bookId: book.id, chapterId: chapter.id };
    await chapterRepository.saveRawText(ref, 'Prima riga dettata online.');
    await waitForPendingWrites(db);

    // ── rete SPENTA (equivalente di modalità aereo per l'SDK) ──
    await disableNetwork(db);
    await chapterRepository.saveRawText(ref, 'Prima riga dettata online. Poi il buio.');

    // l'app continua a vedere il testo aggiornato (latency compensation):
    // l'observe emette dalla cache locale anche senza rete
    const visto = await waitUntil<Chapter>(
      (cb) => chapterRepository.observeChapter(ref, (c) => c !== null && cb(c)),
      (c) => c.rawText.includes('Poi il buio.'),
      'observeChapter emette la modifica offline',
    );
    expect(visto.wordCount).toBe(7);

    // ── rete RIACCESA: la coda di scritture raggiunge l'emulatore ──
    await enableNetwork(db);
    await waitForPendingWrites(db);

    // verifica da un ALTRO client (nuovo contesto = niente cache condivisa):
    // il testo è davvero sul server, non solo nella cache del primo
    const altroClient = env.authenticatedContext(UID).firestore() as unknown as Firestore;
    const snapshot = await getDoc(
      doc(altroClient, 'users', UID, 'books', book.id, 'chapters', chapter.id),
    );
    expect(snapshot.data()?.rawText).toBe('Prima riga dettata online. Poi il buio.');
  });
});

describe('regole per-utente (firestore.rules della fase delle regole Firestore)', () => {
  it('un altro utente non legge i libri di Jane', async () => {
    const { bookRepository } = makeRepos();
    const book = await bookRepository.createBook({ title: 'Privato' });
    await waitForPendingWrites(db);
    const intruso = env.authenticatedContext('altro-utente').firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(intruso, 'users', UID, 'books', book.id)));
  });
});
