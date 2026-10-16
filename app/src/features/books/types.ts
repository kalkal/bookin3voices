// Book access contract (Repository pattern): the UI never
// imports the persistence SDK. The book document carries the denormalized
// counters (wordCount, chapterCount): the Library shows progress by
// reading ONLY the book documents, without downloading the chapters.

import { z } from 'zod';

import type { Unsubscribe } from '../chapters';

/**
 * Book status. The field does not fix the values:
 * the chapter scale (draft → refined → final) is reused, which covers the
 * lifecycle the Library needs.
 */
export const BOOK_STATUSES = ['draft', 'refined', 'final'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

/**
 * Book document as it lives on Firestore, validated at the boundary.
 * Dates travel through the domain as epoch milliseconds: SDK types
 * (Timestamp) never leave the repository.
 */
export const bookDocSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string(),
  author: z.string(),
  description: z.string(),
  synopsis: z.string(),
  genre: z.string(),
  language: z.string(),
  status: z.enum(BOOK_STATUSES),
  /** Active style profile; null until one exists. */
  styleProfileId: z.string().nullable(),
  wordCount: z.number().int().min(0),
  chapterCount: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type BookDoc = z.infer<typeof bookDocSchema>;

/** Full book (document + id), for the Library and Book screens. */
export interface Book extends BookDoc {
  id: string;
}

export interface CreateBookInput {
  title: string;
  author?: string;
  genre?: string;
  language?: string;
}

/** Editable fields of a book (counters are managed by the repository). */
export interface BookPatch {
  title?: string;
  author?: string;
  description?: string;
  synopsis?: string;
  genre?: string;
  language?: string;
  status?: BookStatus;
  styleProfileId?: string | null;
}

/**
 * Full contract. Writes are optimistic (Optimistic UI): they resolve as soon
 * as the mutation is accepted by the persistence layer; the settled outcome
 * arrives through the observe* subscriptions.
 */
export interface BookRepository {
  /** All books, most recently updated first; re-emitted on every change. */
  observeBooks(onChange: (books: Book[]) => void, onError?: (error: Error) => void): Unsubscribe;
  observeBook(
    bookId: string,
    onChange: (book: Book | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
  getBook(bookId: string): Promise<Book | null>;
  createBook(input: CreateBookInput): Promise<Book>;
  updateBook(bookId: string, patch: BookPatch): Promise<void>;
  /** Deletes the book AND its chapters (subcollections are not deleted automatically). */
  deleteBook(bookId: string): Promise<void>;
  /**
   * Recomputes the denormalized counters from the chapters and fixes the book
   * document if they drift (self-healing: increments made offline can be
   * skipped when the session dies before the remote state is known).
   */
  reconcileCounters(bookId: string): Promise<void>;
}
