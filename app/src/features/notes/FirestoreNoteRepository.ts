// NoteRepository on Firestore (Notebook feature). Clones the rules
// of FirestoreChapterRepository:
//  - Zod at the boundary: every document read goes through noteCodec (upgrade-on-read);
//  - optimistic writes: methods resolve as soon as the mutation is queued
//    in the SDK (latency compensation) — awaiting the server ack would block
//    forever when offline. Settled errors arrive on onWriteError;
//  - no denormalized counters: notes do NOT count toward the book's
//    word count (side material), so no increment on books/{bookId};
//  - chronological order: orderBy createdAt desc (most recent first).

import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';

import { timestampsToMillis, toError } from '../../lib/firestoreCodec';
import { decodeNoteDoc, toNote } from './noteCodec';
import type {
  CreateNoteInput,
  Note,
  NotePatch,
  NoteRef,
  NoteRepository,
  Unsubscribe,
} from './types';

export interface FirestoreNoteRepositoryOptions {
  db: Firestore;
  /** Owner of the data: everything lives under users/{uid}. */
  uid: string;
  /**
   * Notification of write errors settled by the server (e.g. permissions).
   * The note is not lost anyway: it stays in the SDK's local offline cache.
   */
  onWriteError?: (error: Error) => void;
}

/**
 * Remote that the offline-first composite (OfflineFirstNoteRepository) can
 * re-sync: besides the NoteRepository contract it must be able to mint an id
 * BEFORE writing (so the durable outbox and the server agree) and to rewrite
 * a note with a known id/createdAt idempotently (recovery of a session that
 * died offline). No impact on the UI, which depends only on NoteRepository.
 */
export interface SyncableNoteRepository extends NoteRepository {
  /** Mints a document id (without writing): needed by the local outbox. */
  newNoteId(bookId: string): string;
  /** (Re)writes a note with a known id/createdAt; resolves on the server ack. */
  putNote(note: Note): Promise<void>;
}

export class FirestoreNoteRepository implements SyncableNoteRepository {
  private readonly db: Firestore;
  private readonly uid: string;
  private readonly onWriteError?: (error: Error) => void;

  constructor(options: FirestoreNoteRepositoryOptions) {
    this.db = options.db;
    this.uid = options.uid;
    this.onWriteError = options.onWriteError;
  }

  private notesCol(bookId: string) {
    return collection(this.db, 'users', this.uid, 'books', bookId, 'notes');
  }

  private noteRef(ref: NoteRef) {
    return doc(this.notesCol(ref.bookId), ref.noteId);
  }

  private keyFor(ref: NoteRef): string {
    return `${ref.bookId}/${ref.noteId}`;
  }

  /** Optimistic write: the server ack is not awaited (see header). */
  private commitInBackground(commit: Promise<unknown>): void {
    commit.catch((error) => {
      const wrapped = toError(error);
      console.warn('Firestore write (note) rejected by the server', wrapped);
      this.onWriteError?.(wrapped);
    });
  }

  private decodeSnapshot(snapshot: DocumentSnapshot, ref: NoteRef): Note | null {
    const data = snapshot.data({ serverTimestamps: 'estimate' });
    if (data === undefined) return null;
    const decoded = decodeNoteDoc(timestampsToMillis(data));
    if (decoded === null) return null;
    return toNote(ref.noteId, ref.bookId, decoded);
  }

  observeNotes(
    bookId: string,
    onChange: (notes: Note[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    const q = query(this.notesCol(bookId), orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const notes: Note[] = [];
        for (const docSnap of snapshot.docs) {
          const note = this.decodeSnapshot(docSnap, { bookId, noteId: docSnap.id });
          if (note === null) {
            // non-conforming payload: skip the row without breaking the list
            console.warn(`Note ${bookId}/${docSnap.id} does not match the schema: skipped`);
            continue;
          }
          notes.push(note);
        }
        onChange(notes);
      },
      (error) => onError?.(toError(error)),
    );
  }

  async getNote(ref: NoteRef): Promise<Note | null> {
    const snapshot = await getDoc(this.noteRef(ref));
    if (!snapshot.exists()) return null;
    const note = this.decodeSnapshot(snapshot, ref);
    if (note === null) {
      // document present but unreadable: never confuse "empty" with "broken"
      throw new Error(`Note ${this.keyFor(ref)} does not match the schema`);
    }
    return note;
  }

  newNoteId(bookId: string): string {
    return doc(this.notesCol(bookId)).id;
  }

  /**
   * Writes the document with a known id. `createdAt` is a client value (milliseconds):
   * observeNotes orders by createdAt, so an already-resolved value keeps the
   * note from "jumping" to the bottom until the server resolves the sentinel
   * (latency compensation), and it matches the optimistically returned note.
   * `updatedAt` stays serverTimestamp: it is the authoritative last-modified date.
   */
  private writeNote(note: Note): Promise<void> {
    return setDoc(doc(this.notesCol(note.bookId), note.id), {
      schemaVersion: 1,
      text: note.text,
      tag: note.tag,
      createdAt: note.createdAt,
      updatedAt: serverTimestamp(),
    });
  }

  async putNote(note: Note): Promise<void> {
    // idempotent: recovery can call it again without creating duplicates (same id)
    await this.writeNote(note);
  }

  async createNote(bookId: string, input: CreateNoteInput): Promise<Note> {
    const now = Date.now();
    const note: Note = {
      id: this.newNoteId(bookId),
      bookId,
      schemaVersion: 1,
      text: input.text,
      tag: input.tag ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.commitInBackground(this.writeNote(note));
    return note;
  }

  async updateNote(ref: NoteRef, patch: NotePatch): Promise<void> {
    this.commitInBackground(
      updateDoc(this.noteRef(ref), { ...patch, updatedAt: serverTimestamp() }),
    );
  }

  async deleteNote(ref: NoteRef): Promise<void> {
    this.commitInBackground(deleteDoc(this.noteRef(ref)));
  }
}
