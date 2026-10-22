import { decodeBookDoc } from '../../books/bookCodec';
import { InMemoryBookRepository } from '../../books/InMemoryBookRepository';
import { decodeChapterDoc } from '../../chapters/chapterCodec';
import { InMemoryChapterRepository } from '../../chapters/InMemoryChapterRepository';
import type { Book } from '../../books/types';
import type { ChapterSummary } from '../../chapters';
import { isExampleSuggestion } from '../../review/example';
import { textHash } from '../../review/textHash';
import { refineResultSchema } from '../../review/types';
import { createOfflineSampleRepositories, NoExampleAvailableError } from '../offlineSample';
import { SAMPLE_BOOK_CONTENT } from '../sampleBookContent';
import { SAMPLE_BOOK_ID, SAMPLE_CHAPTER_IDS } from '../sampleBook';
import { seedSampleBook } from '../seedSampleBook';

const [FIRST] = SAMPLE_BOOK_CONTENT.chapters;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const firstEmission = <T>(subscribe: (cb: (value: T) => void) => () => void): T => {
  let value: T | undefined;
  subscribe((v) => {
    value = v;
  })();
  return value as T;
};

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('createOfflineSampleRepositories (no access code)', () => {
  it('the Library and the Book see the sample book with its three chapters, at once', async () => {
    const repos = createOfflineSampleRepositories(1_000);

    const books = firstEmission<Book[]>((cb) => repos.bookRepository.observeBooks(cb));
    expect(books.map((b) => b.id)).toEqual([SAMPLE_BOOK_ID]);
    const { id, ...bookDoc } = books[0];
    expect(id).toBe(SAMPLE_BOOK_ID);
    expect(decodeBookDoc(bookDoc)).toEqual(bookDoc);

    const chapters = firstEmission<ChapterSummary[]>((cb) =>
      repos.chapterRepository.observeChapters(SAMPLE_BOOK_ID, cb),
    );
    expect(chapters.map((c) => c.id)).toEqual([...SAMPLE_CHAPTER_IDS]);
    for (const chapterId of SAMPLE_CHAPTER_IDS) {
      const chapter = await repos.chapterRepository.getChapter({
        bookId: SAMPLE_BOOK_ID,
        chapterId,
      });
      const { id: _id, bookId: _bookId, ...doc } = chapter!;
      expect(decodeChapterDoc(doc)).toEqual(doc);
    }
  });

  it('dictation and editing save locally', async () => {
    const repos = createOfflineSampleRepositories();
    const ref = { bookId: SAMPLE_BOOK_ID, chapterId: FIRST.id };
    await repos.chapterRepository.saveRawText(ref, `${FIRST.text} One more line.`);
    expect(await repos.chapterRepository.loadRawText(ref)).toBe(`${FIRST.text} One more line.`);
  });

  it('refine serves the labelled examples with no server; nothing to serve is a plain failure', async () => {
    const { suggestionsProvider } = createOfflineSampleRepositories();
    const result = await suggestionsProvider.refine({
      bookId: SAMPLE_BOOK_ID,
      chapterId: FIRST.id,
      text: FIRST.text,
      textHash: textHash(FIRST.text),
      requestId: 'ref-1',
    });
    expect(refineResultSchema.parse(result).suggestions.every(isExampleSuggestion)).toBe(true);

    await expect(
      suggestionsProvider.refine({
        bookId: 'my-own-book',
        chapterId: 'c1',
        text: 'Anything.',
        textHash: textHash('Anything.'),
        requestId: 'ref-2',
      }),
    ).rejects.toBeInstanceOf(NoExampleAvailableError);
  });
});

describe('seedSampleBook (access code accepted)', () => {
  it('creates the book once in the user space, however many times it is called', async () => {
    const chapters = new InMemoryChapterRepository();
    const bookRepository = new InMemoryBookRepository({ chapters });
    const marker = memoryStorage();

    const outcomes = await Promise.all([
      seedSampleBook({ bookRepository, marker, uid: 'judge' }),
      seedSampleBook({ bookRepository, marker, uid: 'judge' }),
    ]);
    expect(outcomes).toEqual(['created', 'created']); // one shared run
    await expect(seedSampleBook({ bookRepository, marker, uid: 'judge' })).resolves.toBe(
      'already-seeded',
    );
    expect(bookRepository.seedWrites).toBe(1);
  });
});
