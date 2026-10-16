// In-memory Notebook repository for tests and development (E2E): full contract
// (CRUD + observeNotes), descending chronological order like
// Firestore. `seed()` sets up the initial state in tests.

import type {
  CreateNoteInput,
  Note,
  NotePatch,
  NoteRef,
  NoteRepository,
  Unsubscribe,
} from './types';

const keyFor = (ref: NoteRef) => `${ref.bookId}/${ref.noteId}`;

export class InMemoryNoteRepository implements NoteRepository {
  private readonly notes = new Map<string, Note>();
  private readonly listeners = new Map<string, Set<(notes: Note[]) => void>>();
  private nextId = 1;
  /** Injectable clock for deterministic timestamps/ordering in tests. */
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Convenient for setting up the initial state in tests/E2E. */
  seed(bookId: string, input: CreateNoteInput & { id?: string; createdAt?: number }): Note {
    const at = input.createdAt ?? this.now();
    const note: Note = {
      id: input.id ?? `nota-${this.nextId++}`,
      bookId,
      schemaVersion: 1,
      text: input.text,
      tag: input.tag ?? null,
      createdAt: at,
      updatedAt: at,
    };
    this.notes.set(keyFor({ bookId, noteId: note.id }), note);
    this.emit(bookId);
    return note;
  }

  observeNotes(bookId: string, onChange: (notes: Note[]) => void): Unsubscribe {
    const listeners = this.listeners.get(bookId) ?? new Set();
    listeners.add(onChange);
    this.listeners.set(bookId, listeners);
    onChange(this.listOf(bookId));
    return () => listeners.delete(onChange);
  }

  async getNote(ref: NoteRef): Promise<Note | null> {
    return this.notes.get(keyFor(ref)) ?? null;
  }

  async createNote(bookId: string, input: CreateNoteInput): Promise<Note> {
    return this.seed(bookId, input);
  }

  async updateNote(ref: NoteRef, patch: NotePatch): Promise<void> {
    const existing = this.notes.get(keyFor(ref));
    if (!existing) throw new Error(`Note does not exist: ${keyFor(ref)}`);
    this.notes.set(keyFor(ref), { ...existing, ...patch, updatedAt: this.now() });
    this.emit(ref.bookId);
  }

  async deleteNote(ref: NoteRef): Promise<void> {
    this.notes.delete(keyFor(ref));
    this.emit(ref.bookId);
  }

  /** Notes of the book, most recent first (createdAt desc, id as tiebreaker). */
  private listOf(bookId: string): Note[] {
    return [...this.notes.values()]
      .filter((note) => note.bookId === bookId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }

  private emit(bookId: string): void {
    const snapshot = this.listOf(bookId);
    for (const listener of this.listeners.get(bookId) ?? []) listener(snapshot);
  }
}
