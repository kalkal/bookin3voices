// Contratto della feature Taccuino (idee/pensieri per libro). Repository
// pattern come per i capitoli: la UI non importa mai l'SDK di
// persistenza, dipende solo da NoteRepository. Le note vivono nella
// sottocollezione books/{bookId}/notes (ciò che cresce nel tempo è
// una sottocollezione), sono cronologiche (più recenti in cima) e non hanno
// contatori denormalizzati: non fanno parte del conteggio del libro.

import { z } from 'zod';

/** Coordinate di una nota dentro un libro (rispecchia il path). */
export interface NoteRef {
  bookId: string;
  noteId: string;
}

/**
 * Categorie libere di una nota (mockup Taccuino). `null` = nessun tag: una
 * nota può nascere senza categoria e restare tale.
 */
export const NOTE_TAGS = ['trama', 'dialogo', 'atmosfera', 'dubbio', 'idea'] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

/**
 * Documento nota come vive su Firestore, validato al confine.
 * `createdAt`/`updatedAt` viaggiano nel dominio come millisecondi epoch: i tipi
 * dell'SDK (Timestamp) non escono mai dal repository. `tag` è additivo e
 * nullable: default null normalizza i documenti senza categoria.
 */
export const noteDocSchema = z.object({
  schemaVersion: z.literal(1),
  text: z.string(),
  tag: z.enum(NOTE_TAGS).nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type NoteDoc = z.infer<typeof noteDocSchema>;

/** Nota completa (documento + coordinate), per lista e schede. */
export interface Note extends NoteDoc {
  id: string;
  bookId: string;
}

/** Dati per creare una nota: il testo, con tag opzionale. */
export interface CreateNoteInput {
  text: string;
  tag?: NoteTag | null;
}

/** Campi modificabili di una nota. */
export interface NotePatch {
  text?: string;
  tag?: NoteTag | null;
}

/** Ferma una sottoscrizione observe* (Observer del). */
export type Unsubscribe = () => void;

/**
 * Contratto del Taccuino. Le scritture sono ottimistiche
 * (Optimistic UI): risolvono appena la mutazione è presa in carico dal
 * layer di persistenza; l'esito consolidato arriva da observeNotes. Nessun
 * reorder: le note sono cronologiche, ordinate per createdAt discendente.
 */
export interface NoteRepository {
  /** Lista per createdAt desc (più recenti in cima); si riemette a ogni cambiamento. */
  observeNotes(
    bookId: string,
    onChange: (notes: Note[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
  getNote(ref: NoteRef): Promise<Note | null>;
  createNote(bookId: string, input: CreateNoteInput): Promise<Note>;
  updateNote(ref: NoteRef, patch: NotePatch): Promise<void>;
  deleteNote(ref: NoteRef): Promise<void>;
}
