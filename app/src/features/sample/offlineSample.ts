// Judges' build WITHOUT the access code: the app touches nothing on the server.
// The sample book is shown from the bundled content through the same
// repository interfaces the app uses, in memory: dictation and editing work
// locally, nothing syncs, and a restart starts again from the bundled text.
// Refinement serves only the labelled pre-recorded examples.

import { InMemoryBookRepository } from '../books/InMemoryBookRepository';
import type { BookRepository } from '../books/types';
import { InMemoryChapterRepository } from '../chapters/InMemoryChapterRepository';
import type { ChapterRepository } from '../chapters';
import { InMemoryNoteRepository } from '../notes/InMemoryNoteRepository';
import type { NoteRepository } from '../notes';
import type { RefineRequest, RefineResult, SuggestionsProvider } from '../review/types';
import { exampleRefineResult } from './exampleRefine';
import { SAMPLE_BOOK_ID, sampleBookDocs } from './sampleBook';

export interface OfflineSampleRepositories {
  bookRepository: BookRepository;
  chapterRepository: ChapterRepository;
  noteRepository: NoteRepository;
  /** Pre-recorded examples only: never a call to the server. */
  suggestionsProvider: SuggestionsProvider;
}

/** Thrown when there is no example for the text: the editor shows its plain "AI unreachable" message. */
export class NoExampleAvailableError extends Error {
  constructor() {
    super('No pre-recorded example for this text');
    this.name = 'NoExampleAvailableError';
  }
}

/** Serves the pre-recorded examples of the sample book; anything else fails without a network call. */
export class ExampleOnlySuggestionsProvider implements SuggestionsProvider {
  async refine(request: RefineRequest): Promise<RefineResult> {
    const example = exampleRefineResult(request.bookId, request.chapterId, request.text, {
      range: request.range,
      rejected: request.rejected,
    });
    if (example === undefined) throw new NoExampleAvailableError();
    console.info('refine-example-offline', {
      requestId: request.requestId,
      chapterId: request.chapterId,
      count: example.suggestions.length,
    });
    return example;
  }
}

/**
 * Local repositories pre-filled with the sample book (book `sample`, chapters
 * `sample-1..3`), the same documents the Firestore seeding writes.
 */
export function createOfflineSampleRepositories(
  nowMillis: number = Date.now(),
): OfflineSampleRepositories {
  const chapterRepository = new InMemoryChapterRepository();
  const bookRepository = new InMemoryBookRepository({ chapters: chapterRepository });
  const { book, chapters } = sampleBookDocs(nowMillis);
  // fresh in-memory store: always 'created'
  void bookRepository.createBookIfMissing(SAMPLE_BOOK_ID, book, chapters);
  return {
    bookRepository,
    chapterRepository,
    noteRepository: new InMemoryNoteRepository(),
    suggestionsProvider: new ExampleOnlySuggestionsProvider(),
  };
}
