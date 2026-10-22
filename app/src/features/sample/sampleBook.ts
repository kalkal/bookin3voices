// The bundled sample book (judges' build only, EXPO_PUBLIC_SAMPLE_BOOK=1):
// fixed ids and the exact documents the app itself writes, so the decoders read
// them like any other book.

import { newBookDoc } from '../books/bookCodec';
import type { BookDoc, SeedChapter } from '../books/types';
import type { ChapterDoc } from '../chapters';
import { countWords } from '../../lib/text';
import { SAMPLE_BOOK_CONTENT } from './sampleBookContent';
import type { SampleChapterContent } from './types';

/** On only in the judges' build (variable inlined in the bundle at build time). */
export const isSampleBookEnabled = process.env.EXPO_PUBLIC_SAMPLE_BOOK === '1';

/** Fixed id of the sample book, the same in every user's space. */
export const SAMPLE_BOOK_ID = SAMPLE_BOOK_CONTENT.id;

/** Fixed chapter ids, in reading order (sample-1, sample-2, ...). */
export const SAMPLE_CHAPTER_IDS: readonly string[] = SAMPLE_BOOK_CONTENT.chapters.map((c) => c.id);

/** The bundled chapter, or undefined when the coordinates are not the sample book's. */
export function sampleChapter(bookId: string, chapterId: string): SampleChapterContent | undefined {
  if (bookId !== SAMPLE_BOOK_ID) return undefined;
  return SAMPLE_BOOK_CONTENT.chapters.find((chapter) => chapter.id === chapterId);
}

/**
 * Book and chapter documents with the shape newBookDoc and createChapter write,
 * counters already filled in (no increments needed, nothing to reconcile).
 */
export function sampleBookDocs(nowMillis: number): { book: BookDoc; chapters: SeedChapter[] } {
  const chapters: SeedChapter[] = SAMPLE_BOOK_CONTENT.chapters.map((chapter, order) => {
    const doc: ChapterDoc = {
      schemaVersion: 1,
      order,
      title: chapter.title,
      status: 'draft',
      wordCount: countWords(chapter.text),
      rawText: chapter.text,
      outline: {
        summary: chapter.outline.summary,
        beats: [...chapter.outline.beats],
        beatsDone: [],
      },
      updatedAt: nowMillis,
    };
    return { id: chapter.id, doc };
  });
  const book: BookDoc = {
    ...newBookDoc(
      {
        title: SAMPLE_BOOK_CONTENT.title,
        author: SAMPLE_BOOK_CONTENT.author,
        genre: SAMPLE_BOOK_CONTENT.genre,
        language: SAMPLE_BOOK_CONTENT.language,
      },
      nowMillis,
    ),
    description: SAMPLE_BOOK_CONTENT.description,
    synopsis: SAMPLE_BOOK_CONTENT.synopsis,
    styleProfileId: SAMPLE_BOOK_CONTENT.styleProfileId,
    wordCount: chapters.reduce((sum, chapter) => sum + chapter.doc.wordCount, 0),
    chapterCount: chapters.length,
  };
  return { book, chapters };
}
