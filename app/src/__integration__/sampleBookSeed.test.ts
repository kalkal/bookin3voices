/**
 * Integration test of the sample book seeding against the EMULATOR with the
 * repo's real rules: the transaction of createBookIfMissing passes the rules,
 * two racing clients write the book once, and the documents read back through
 * the app's own decoders.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, type Firestore } from 'firebase/firestore';

import { FirestoreBookRepository } from '../features/books/FirestoreBookRepository';
import { FirestoreChapterRepository } from '../features/chapters/FirestoreChapterRepository';
import { SAMPLE_BOOK_ID, SAMPLE_CHAPTER_IDS, sampleBookDocs } from '../features/sample/sampleBook';

const PROJECT_ID = 'demo-bookvoice-app';
const UID = 'judge-test';
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

const clientDb = () => env.authenticatedContext(UID).firestore() as unknown as Firestore;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...emulatorHostAndPort(), rules: RULES },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

describe('FirestoreBookRepository.createBookIfMissing (sample book)', () => {
  it('two racing clients: one creates, the other finds it; no duplicate chapters', async () => {
    const { book, chapters } = sampleBookDocs(Date.now());
    const first = new FirestoreBookRepository({ db: clientDb(), uid: UID });
    const second = new FirestoreBookRepository({ db: clientDb(), uid: UID });

    const outcomes = await Promise.all([
      first.createBookIfMissing(SAMPLE_BOOK_ID, book, chapters),
      second.createBookIfMissing(SAMPLE_BOOK_ID, book, chapters),
    ]);
    expect([...outcomes].sort()).toEqual(['created', 'exists']);

    const db = clientDb();
    const stored = await getDocs(collection(db, 'users', UID, 'books', SAMPLE_BOOK_ID, 'chapters'));
    expect(stored.docs.map((d) => d.id).sort()).toEqual([...SAMPLE_CHAPTER_IDS].sort());

    // read back through the app's decoders
    const books = new FirestoreBookRepository({ db, uid: UID });
    expect(await books.getBook(SAMPLE_BOOK_ID)).toMatchObject({
      title: book.title,
      chapterCount: 3,
      wordCount: book.wordCount,
    });
    const chapterRepository = new FirestoreChapterRepository({ db, uid: UID });
    const firstChapter = await chapterRepository.getChapter({
      bookId: SAMPLE_BOOK_ID,
      chapterId: SAMPLE_CHAPTER_IDS[0],
    });
    expect(firstChapter?.rawText).toBe(chapters[0].doc.rawText);
  });

  it('an existing sample book is left as the user edited it', async () => {
    const { book, chapters } = sampleBookDocs(Date.now());
    const repo = new FirestoreBookRepository({ db: clientDb(), uid: UID });
    await repo.createBookIfMissing(SAMPLE_BOOK_ID, { ...book, title: 'Edited' }, chapters);

    await expect(repo.createBookIfMissing(SAMPLE_BOOK_ID, book, chapters)).resolves.toBe('exists');
    expect((await repo.getBook(SAMPLE_BOOK_ID))?.title).toBe('Edited');
  });
});

describe('the same seeding under the judges demo rules (firestore.demo.rules)', () => {
  const DEMO_RULES = readFileSync(
    join(__dirname, '..', '..', '..', 'firestore.demo.rules'),
    'utf8',
  );
  const CODE_HASH = 'c'.repeat(64);
  let demoEnv: RulesTestEnvironment;

  beforeAll(async () => {
    demoEnv = await initializeTestEnvironment({
      projectId: 'demo-bookvoice-judges',
      firestore: { ...emulatorHostAndPort(), rules: DEMO_RULES },
    });
  });

  beforeEach(async () => {
    await demoEnv.clearFirestore();
    await demoEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'config/demo'), {
        enabled: true,
        expiresAt: Date.now() + 86_400_000,
        codeSha256: CODE_HASH,
      });
      await setDoc(doc(db, `demoAccess/${UID}`), { codeSha256: CODE_HASH });
    });
  });

  afterAll(async () => {
    await demoEnv.cleanup();
  });

  it('after the code (claim + marker) the seeding transaction passes', async () => {
    const db = demoEnv
      .authenticatedContext(UID, { judge: true })
      .firestore() as unknown as Firestore;
    const { book, chapters } = sampleBookDocs(Date.now());
    const repo = new FirestoreBookRepository({ db, uid: UID });
    await expect(repo.createBookIfMissing(SAMPLE_BOOK_ID, book, chapters)).resolves.toBe('created');
  });

  it('without the claim it is refused: nothing is written on the server', async () => {
    const db = demoEnv.authenticatedContext(UID).firestore() as unknown as Firestore;
    const { book, chapters } = sampleBookDocs(Date.now());
    const repo = new FirestoreBookRepository({ db, uid: UID });
    await expect(repo.createBookIfMissing(SAMPLE_BOOK_ID, book, chapters)).rejects.toThrow();
  });
});
