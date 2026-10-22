import { join } from 'node:path';

import { decodeBookDoc } from '../../books/bookCodec';
import { InMemoryBookRepository } from '../../books/InMemoryBookRepository';
import type { BookSeeder } from '../../books/types';
import { decodeChapterDoc } from '../../chapters/chapterCodec';
import { InMemoryChapterRepository } from '../../chapters/InMemoryChapterRepository';
import type { KeyValueStorage } from '../../chapters';
import { countWords } from '../../../lib/text';
import { SAMPLE_BOOK_CONTENT } from '../sampleBookContent';
import {
  isSampleBookEnabled,
  SAMPLE_BOOK_ID,
  SAMPLE_CHAPTER_IDS,
  sampleBookDocs,
} from '../sampleBook';
import { ensureSampleBook, sampleSeedMarkerKey } from '../seedSampleBook';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildSampleBookContent } = require('../../../../scripts/build-sample-book.js');

const CONTENT_DIR = join(__dirname, '../../../../../content/sample-book');

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
}

function stores() {
  const chapters = new InMemoryChapterRepository();
  const books = new InMemoryBookRepository({ chapters });
  return { books, chapters };
}

async function chapterIdsOf(chapters: InMemoryChapterRepository): Promise<string[]> {
  return new Promise((resolve) => {
    const stop = chapters.observeChapters(SAMPLE_BOOK_ID, (list) => resolve(list.map((c) => c.id)));
    stop();
  });
}

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('sample book content', () => {
  it('the bundled module is generated from content/sample-book (else run scripts/build-sample-book.js)', () => {
    expect(SAMPLE_BOOK_CONTENT).toEqual(buildSampleBookContent(CONTENT_DIR));
  });

  it('is an English historical book: title, synopsis with its year, three chapters of 500-800 words', () => {
    expect(SAMPLE_BOOK_CONTENT.language).toBe('en');
    expect(SAMPLE_BOOK_CONTENT.styleProfileId).toBe('historical');
    expect(SAMPLE_BOOK_CONTENT.title).not.toBe('');
    expect(SAMPLE_BOOK_CONTENT.synopsis).toMatch(/Murano, winter of 1608/);
    expect(SAMPLE_CHAPTER_IDS).toEqual(['sample-1', 'sample-2', 'sample-3']);
    for (const chapter of SAMPLE_BOOK_CONTENT.chapters) {
      expect(chapter.title).not.toBe('');
      const words = countWords(chapter.text);
      expect(words).toBeGreaterThanOrEqual(500);
      expect(words).toBeLessThanOrEqual(800);
    }
  });

  it('is off unless the judges build sets EXPO_PUBLIC_SAMPLE_BOOK=1', () => {
    expect(isSampleBookEnabled).toBe(false);
  });
});

describe('sampleBookDocs', () => {
  it('the app decoders accept the seeded book and chapters as they are', () => {
    const { book, chapters } = sampleBookDocs(1_000);
    expect(decodeBookDoc({ ...book })).toEqual(book);
    expect(book).toMatchObject({
      schemaVersion: 1,
      title: SAMPLE_BOOK_CONTENT.title,
      genre: 'Historical fiction',
      language: 'en',
      status: 'draft',
      chapterCount: 3,
    });
    for (const [order, chapter] of chapters.entries()) {
      expect(decodeChapterDoc({ ...chapter.doc })).toEqual(chapter.doc);
      expect(chapter.doc.order).toBe(order);
      expect(chapter.doc.wordCount).toBe(countWords(chapter.doc.rawText));
      expect(chapter.doc.outline?.beatsDone).toEqual([]);
    }
    // the denormalized counter already matches the chapters: nothing to reconcile
    expect(book.wordCount).toBe(chapters.reduce((sum, c) => sum + c.doc.wordCount, 0));
  });
});

describe('ensureSampleBook', () => {
  it('creates the book with fixed ids once; a second start does nothing', async () => {
    const { books, chapters } = stores();
    const marker = memoryStorage();

    await expect(ensureSampleBook({ store: books, marker, uid: 'u1' })).resolves.toBe('created');
    await expect(ensureSampleBook({ store: books, marker, uid: 'u1' })).resolves.toBe(
      'already-seeded',
    );

    expect(books.seedWrites).toBe(1);
    expect((await books.getBook(SAMPLE_BOOK_ID))?.title).toBe(SAMPLE_BOOK_CONTENT.title);
    expect(await chapterIdsOf(chapters)).toEqual(['sample-1', 'sample-2', 'sample-3']);
    expect(marker.data.has(sampleSeedMarkerKey('u1'))).toBe(true);
  });

  it('two concurrent starts in the same process share one run', async () => {
    const { books } = stores();
    const createBookIfMissing = jest.spyOn(books, 'createBookIfMissing');
    const marker = memoryStorage();

    const outcomes = await Promise.all([
      ensureSampleBook({ store: books, marker, uid: 'u1' }),
      ensureSampleBook({ store: books, marker, uid: 'u1' }),
    ]);

    expect(outcomes).toEqual(['created', 'created']);
    expect(createBookIfMissing).toHaveBeenCalledTimes(1);
    expect(books.seedWrites).toBe(1);
  });

  it('racing starts with no shared marker (reinstall, second process) never duplicate', async () => {
    const { books, chapters } = stores();
    // one repository instance per process, all over the same database
    const newProcess = (): BookSeeder => ({
      createBookIfMissing: (...args) => books.createBookIfMissing(...args),
    });

    const outcomes = await Promise.all([
      ensureSampleBook({ store: newProcess(), marker: memoryStorage(), uid: 'u1' }),
      ensureSampleBook({ store: newProcess(), marker: memoryStorage(), uid: 'u1' }),
      ensureSampleBook({ store: newProcess(), marker: memoryStorage(), uid: 'u1' }),
    ]);

    expect([...outcomes].sort()).toEqual(['created', 'exists', 'exists']);
    expect(books.seedWrites).toBe(1);
    expect(await chapterIdsOf(chapters)).toEqual(['sample-1', 'sample-2', 'sample-3']);
  });

  it('an existing sample book is never overwritten (the user may have edited it)', async () => {
    const { books } = stores();
    books.seed({ id: SAMPLE_BOOK_ID, title: 'My edited title' });

    await expect(
      ensureSampleBook({ store: books, marker: memoryStorage(), uid: 'u1' }),
    ).resolves.toBe('exists');
    expect((await books.getBook(SAMPLE_BOOK_ID))?.title).toBe('My edited title');
  });

  it('a deleted sample book does not come back on the next start', async () => {
    const { books } = stores();
    const marker = memoryStorage();
    await ensureSampleBook({ store: books, marker, uid: 'u1' });
    await books.deleteBook(SAMPLE_BOOK_ID);

    await expect(ensureSampleBook({ store: books, marker, uid: 'u1' })).resolves.toBe(
      'already-seeded',
    );
    expect(await books.getBook(SAMPLE_BOOK_ID)).toBeNull();
  });

  it('a failed write (offline) is logged without user data and retried on the next start', async () => {
    const { books } = stores();
    const marker = memoryStorage();
    const flaky: BookSeeder = {
      createBookIfMissing: jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }))
        .mockImplementation((...args: Parameters<BookSeeder['createBookIfMissing']>) =>
          books.createBookIfMissing(...args),
        ),
    };

    await expect(ensureSampleBook({ store: flaky, marker, uid: 'u1' })).resolves.toBe('failed');
    expect(console.warn).toHaveBeenCalledWith('sample-book-seed-failed', { code: 'unavailable' });
    expect(marker.data.size).toBe(0);

    await expect(ensureSampleBook({ store: flaky, marker, uid: 'u1' })).resolves.toBe('created');
    expect(books.seedWrites).toBe(1);
  });
});
