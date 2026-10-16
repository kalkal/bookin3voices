// Repository libri in memoria per test e sviluppo (come InMemoryChapterRepository).

import { newBookDoc, toBook } from './bookCodec';
import type { Unsubscribe } from '../chapters';
import type { Book, BookPatch, BookRepository, CreateBookInput } from './types';

export class InMemoryBookRepository implements BookRepository {
  private readonly books = new Map<string, Book>();
  private readonly listListeners = new Set<(books: Book[]) => void>();
  private readonly docListeners = new Map<string, Set<(book: Book | null) => void>>();
  private nextId = 1;
  /** Contatore delle riconciliazioni richieste (per le asserzioni nei test). */
  reconcileCalls: string[] = [];

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

  async updateBook(bookId: string, patch: BookPatch): Promise<void> {
    const existing = this.books.get(bookId);
    if (!existing) throw new Error(`Libro inesistente: ${bookId}`);
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

  /** Comodo per preparare lo stato iniziale nei test. */
  seed(book: Partial<Book> & { id: string; title: string }): Book {
    const full: Book = {
      ...toBook(book.id, newBookDoc({ title: book.title }, Date.now())),
      ...book,
    };
    this.books.set(full.id, full);
    this.emit(full.id);
    return full;
  }

  /** Aggiorna i contatori denormalizzati, come farebbe il repository capitoli. */
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
