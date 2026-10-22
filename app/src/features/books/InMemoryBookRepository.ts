// In-memory book repository for tests and development (like InMemoryChapterRepository).

import { newBookDoc, toBook } from './bookCodec';
import type { InMemoryChapterRepository, Unsubscribe } from '../chapters';
import type {
  Book,
  BookDoc,
  BookPatch,
  BookRepository,
  BookSeeder,
  CreateBookInput,
  SeedChapter,
  SeedOutcome,
} from './types';

export interface InMemoryBookRepositoryOptions {
  /** Where createBookIfMissing puts the chapters (the Firestore twin writes both together). */
  chapters?: InMemoryChapterRepository;
}

export class InMemoryBookRepository implements BookRepository, BookSeeder {
  private readonly books = new Map<string, Book>();
  private readonly listListeners = new Set<(books: Book[]) => void>();
  private readonly docListeners = new Map<string, Set<(book: Book | null) => void>>();
  private nextId = 1;
  /** Count of requested reconciliations (for assertions in tests). */
  reconcileCalls: string[] = [];
  /** Count of createBookIfMissing calls that actually wrote (for assertions in tests). */
  seedWrites = 0;
  private readonly chapterSink?: InMemoryChapterRepository;

  constructor(options: InMemoryBookRepositoryOptions = {}) {
    this.chapterSink = options.chapters;
  }

  observeBooks(onChange: (books: Book[]) => void): Unsubscribe {
    this.listListeners.add(onChange);
    onChange(this.list());
    return () => this.listListeners.delete(onChange);
  }

  observeBook(bookId: string, onChange: (book: Book | null) => void): Unsubscribe {
    const listeners = this.docListeners.get(bookId) ?? new Set();
    listeners.add(onChange);
    this.docListeners.set(bookId, listeners);
    onChange(this.books.get(bookId) ?? null);
    return () => listeners.delete(onChange);
  }

  async getBook(bookId: string): Promise<Book | null> {
    return this.books.get(bookId) ?? null;
  }

  async createBook(input: CreateBookInput): Promise<Book> {
    const book = toBook(`libro-${this.nextId++}`, newBookDoc(input, Date.now()));
    this.books.set(book.id, book);
    this.emit(book.id);
    return book;
  }

  async createBookIfMissing(
    bookId: string,
    book: BookDoc,
    chapters: readonly SeedChapter[],
  ): Promise<SeedOutcome> {
    // check and write with no await in between: atomic, like the transaction
    if (this.books.has(bookId)) return 'exists';
    this.books.set(bookId, toBook(bookId, book));
    for (const chapter of chapters) {
      this.chapterSink?.seed({ bookId, chapterId: chapter.id }, chapter.doc.rawText, chapter.doc);
    }
    this.seedWrites += 1;
    this.emit(bookId);
    return 'created';
  }

  async updateBook(bookId: string, patch: BookPatch): Promise<void> {
    const existing = this.books.get(bookId);
    if (!existing) throw new Error(`Book does not exist: ${bookId}`);
    this.books.set(bookId, { ...existing, ...patch, updatedAt: Date.now() });
    this.emit(bookId);
  }

  async deleteBook(bookId: string): Promise<void> {
    this.books.delete(bookId);
    this.emit(bookId);
  }

  async reconcileCounters(bookId: string): Promise<void> {
    this.reconcileCalls.push(bookId);
  }

  /** Convenient for setting up the initial state in tests. */
  seed(book: Partial<Book> & { id: string; title: string }): Book {
    const full: Book = {
      ...toBook(book.id, newBookDoc({ title: book.title }, Date.now())),
      ...book,
    };
    this.books.set(full.id, full);
    this.emit(full.id);
    return full;
  }

  /** Updates the denormalized counters, as the chapter repository would. */
  setCounters(bookId: string, counters: { wordCount?: number; chapterCount?: number }): void {
    const existing = this.books.get(bookId);
    if (!existing) return;
    this.books.set(bookId, { ...existing, ...counters, updatedAt: Date.now() });
    this.emit(bookId);
  }

  private list(): Book[] {
    return [...this.books.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private emit(bookId: string): void {
    const books = this.list();
    for (const listener of this.listListeners) listener(books);
    const book = this.books.get(bookId) ?? null;
    for (const listener of this.docListeners.get(bookId) ?? []) listener(book);
  }
}
