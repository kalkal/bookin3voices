// Contratto di accesso ai libri (Repository pattern): la UI non
// importa mai l'SDK di persistenza. Il documento libro porta i contatori
// denormalizzati (wordCount, chapterCount): la Libreria mostra i progressi
// leggendo SOLO i documenti libro, senza scaricare i capitoli.

import { z } from 'zod';

import type { Unsubscribe } from '../chapters';

/**
 * Stato del libro. Il campo non fissa i valori:
 * si riusa la scala dei capitoli (bozza → rifinito → finale), che copre il
 * ciclo di vita che serve alla Libreria.
 */
export const BOOK_STATUSES = ['draft', 'refined', 'final'] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

/**
 * Documento libro come vive su Firestore, validato al confine.
 * Le date viaggiano nel dominio come millisecondi epoch: i tipi dell'SDK
 * (Timestamp) non escono mai dal repository.
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
  /** Profilo di stile attivo; null finché non esiste. */
  styleProfileId: z.string().nullable(),
  wordCount: z.number().int().min(0),
  chapterCount: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type BookDoc = z.infer<typeof bookDocSchema>;

/** Libro completo (documento + id), per Libreria e schermata Libro. */
export interface Book extends BookDoc {
  id: string;
}

export interface CreateBookInput {
  title: string;
  author?: string;
  genre?: string;
  language?: string;
}

/** Campi modificabili di un libro (i contatori li gestisce il repository). */
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
 * Contratto completo. Le scritture sono ottimistiche (Optimistic UI):
 * risolvono appena la mutazione è presa in carico dal layer di persistenza;
 * l'esito consolidato arriva dagli observe*.
 */
export interface BookRepository {
  /** Tutti i libri, dal più recente aggiornato; si riemette a ogni cambiamento. */
  observeBooks(onChange: (books: Book[]) => void, onError?: (error: Error) => void): Unsubscribe;
  observeBook(
    bookId: string,
    onChange: (book: Book | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
  getBook(bookId: string): Promise<Book | null>;
  createBook(input: CreateBookInput): Promise<Book>;
  updateBook(bookId: string, patch: BookPatch): Promise<void>;
  /** Elimina il libro E i suoi capitoli (le sottocollezioni non si eliminano da sole). */
  deleteBook(bookId: string): Promise<void>;
  /**
   * Ricalcola i contatori denormalizzati dai capitoli e corregge il documento
   * libro se derivano (self-healing: gli increment fatti offline possono
   * saltare quando la sessione muore prima di conoscere lo stato remoto).
   */
  reconcileCounters(bookId: string): Promise<void>;
}
