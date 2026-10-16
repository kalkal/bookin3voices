// DURABLE LOCAL outbox of notes (Notebook feature). The Firestore JS SDK on
// React Native has ONLY an in-memory cache: a note created offline lives in
// RAM and dies with the app before syncing. As for chapters (LocalChapterRepository),
// this module provides the on-disk safety net:
// every created note goes FIRST into an AsyncStorage outbox (durable, Zod at the
// boundary), then into Firestore; if the remote does not answer, the note stays here
// and is re-synced at the next opportunity (OfflineFirstNoteRepository).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { NOTE_TAGS } from './types';
import type { Note, NoteRef } from './types';

// external data (here: disk) validated at the boundary with Zod
const storedNoteSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  bookId: z.string(),
  text: z.string(),
  tag: z.enum(NOTE_TAGS).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const outboxSchema = z.array(storedNoteSchema);

const keyFor = (bookId: string) => `bookvoice/notes-outbox/${bookId}`;

/** Subset of AsyncStorage used by the repository, injectable in tests. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Outbox of notes not yet confirmed by the server, one entry per book.
 * It is not a full mirror of the Notebook: already-synced notes come from
 * Firestore via observe. Only creations awaiting an ack live here.
 */
export class LocalNoteRepository {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = AsyncStorage) {
    this.storage = storage;
  }

  /** Pending notes for the book (empty array if none or unreadable payload). */
  async listPending(bookId: string): Promise<Note[]> {
    const raw = await this.storage.getItem(keyFor(bookId));
    if (raw === null) return [];
    const parsed = parseOutbox(raw);
    if (parsed === null) {
      // corrupt payload or from a future schema: text is NEVER thrown away —
      // it is set aside with a timestamp and we restart from an empty outbox
      await this.storage.setItem(`${keyFor(bookId)}:quarantena-${Date.now()}`, raw);
      return [];
    }
    return parsed;
  }

  /** Inserts or updates (by id) a pending note. */
  async savePending(note: Note): Promise<void> {
    const current = await this.listPending(note.bookId);
    const next = current.filter((n) => n.id !== note.id);
    next.push(note);
    await this.write(note.bookId, next);
  }

  /** Removes a note from the outbox (confirmed by the server, or deleted). */
  async removePending(ref: NoteRef): Promise<void> {
    const current = await this.listPending(ref.bookId);
    const next = current.filter((n) => n.id !== ref.noteId);
    if (next.length === current.length) return;
    await this.write(ref.bookId, next);
  }

  private async write(bookId: string, notes: Note[]): Promise<void> {
    await this.storage.setItem(keyFor(bookId), JSON.stringify(notes));
  }
}

function parseOutbox(raw: string): Note[] | null {
  try {
    return outboxSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
