// Contract of the Notebook feature (ideas/thoughts per book). Repository
// pattern as for chapters: the UI never imports the persistence
// SDK, it depends only on NoteRepository. Notes live in the
// subcollection books/{bookId}/notes (whatever grows over time is
// a subcollection), are chronological (most recent first) and have no
// denormalized counters: they are not part of the book's word count.

import { z } from 'zod';

/** Coordinates of a note inside a book (mirrors the path). */
export interface NoteRef {
  bookId: string;
  noteId: string;
}

/**
 * Free-form categories of a note. `null` = no tag: a
 * note can be born without a category and stay that way.
 */
export const NOTE_TAGS = ['trama', 'dialogo', 'atmosfera', 'dubbio', 'idea'] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

/**
 * Note document as it lives on Firestore, validated at the boundary.
 * `createdAt`/`updatedAt` travel through the domain as epoch milliseconds: SDK
 * types (Timestamp) never leave the repository. `tag` is additive and
 * nullable: default null normalizes documents without a category.
 */
export const noteDocSchema = z.object({
  schemaVersion: z.literal(1),
  text: z.string(),
  tag: z.enum(NOTE_TAGS).nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type NoteDoc = z.infer<typeof noteDocSchema>;

/** Full note (document + coordinates), for the list and cards. */
export interface Note extends NoteDoc {
  id: string;
  bookId: string;
}

/** Data to create a note: the text, with an optional tag. */
export interface CreateNoteInput {
  text: string;
  tag?: NoteTag | null;
}

/** Editable fields of a note. */
export interface NotePatch {
  text?: string;
  tag?: NoteTag | null;
}

/** Stops an observe* subscription (Observer pattern). */
export type Unsubscribe = () => void;

/**
 * Notebook contract. Writes are optimistic
 * (Optimistic UI): they resolve as soon as the mutation is accepted by the
 * persistence layer; the settled outcome arrives from observeNotes. No
 * reorder: notes are chronological, ordered by createdAt descending.
 */
export interface NoteRepository {
  /** List by createdAt desc (most recent first); re-emitted on every change. */
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
