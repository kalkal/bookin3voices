// Offline-first composite for notes (Notebook feature). Same safety net
// as chapters (OfflineFirstChapterRepository): the cache of the Firestore JS SDK
// on React Native is memory-only, so a note created offline
// would die with the app before syncing. Here every creation touches the durable
// outbox FIRST (LocalNoteRepository on AsyncStorage) and THEN Firestore,
// optimistically; if the remote rejects/is offline the note stays in the outbox and is
// re-synced (recovery) at the next open/observe. Notes already
// synced come from Firestore via observe; the view is the union of the two
// sources, deduplicated by id (the remote wins). Goal: a saved note is
// never lost, not even offline with the app killed.

import { toError } from '../../lib/firestoreCodec';
import type { LocalNoteRepository } from './LocalNoteRepository';
import type { SyncableNoteRepository } from './FirestoreNoteRepository';
import type {
  CreateNoteInput,
  Note,
  NotePatch,
  NoteRef,
  NoteRepository,
  Unsubscribe,
} from './types';

export interface OfflineFirstNoteRepositoryOptions {
  remote: SyncableNoteRepository;
  mirror: LocalNoteRepository;
  /** Settled errors (e.g. permissions) from the optimistic sync attempt. */
  onError?: (error: Error) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export class OfflineFirstNoteRepository implements NoteRepository {
  private readonly remote: SyncableNoteRepository;
  private readonly mirror: LocalNoteRepository;
  private readonly onError?: (error: Error) => void;
  private readonly now: () => number;

  /** Pending notes in memory, per book (mirror of the on-disk outbox). */
  private readonly pending = new Map<string, Map<string, Note>>();
  /** Outbox already loaded from disk for this book (read only once). */
  private readonly loaded = new Set<string>();
  /** Last remote emission, per book (basis of the merge). */
  private readonly lastRemote = new Map<string, Note[]>();
  /** Active re-emitters, per book: called by whoever changes the state. */
  private readonly refreshers = new Map<string, Set<() => void>>();

  constructor(options: OfflineFirstNoteRepositoryOptions) {
    this.remote = options.remote;
    this.mirror = options.mirror;
    this.onError = options.onError;
    this.now = options.now ?? Date.now;
  }

  private async ensurePending(bookId: string): Promise<Map<string, Note>> {
    let map = this.pending.get(bookId);
    if (map === undefined) {
      map = new Map();
      this.pending.set(bookId, map);
    }
    if (!this.loaded.has(bookId)) {
      this.loaded.add(bookId);
      for (const note of await this.mirror.listPending(bookId)) map.set(note.id, note);
    }
    return map;
  }

  /** Merged view: remote ∪ outbox, deduplicated by id (remote wins), desc. */
  private merge(bookId: string): Note[] {
    const byId = new Map<string, Note>();
    for (const note of this.lastRemote.get(bookId) ?? []) byId.set(note.id, note);
    for (const note of this.pending.get(bookId)?.values() ?? []) {
      if (!byId.has(note.id)) byId.set(note.id, note);
    }
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  }

  private refresh(bookId: string): void {
    for (const r of this.refreshers.get(bookId) ?? []) r();
  }

  /** Re-pushes pending notes to the remote (recovery of a dead session). */
  private async recover(bookId: string): Promise<void> {
    const map = await this.ensurePending(bookId);
    for (const note of [...map.values()]) {
      // putNote resolves only on the server ack: offline it stays pending (durable),
      // online it confirms and removes from the outbox. Idempotent (same id): no duplicates.
      this.remote
        .putNote(note)
        .then(() => this.confirm(note))
        .catch(() => {
          // still unreachable: the note stays in the outbox for the next round
        });
    }
  }

  private async confirm(note: Note): Promise<void> {
    this.pending.get(note.bookId)?.delete(note.id);
    await this.mirror.removePending({ bookId: note.bookId, noteId: note.id });
    this.refresh(note.bookId);
  }

  observeNotes(
    bookId: string,
    onChange: (notes: Note[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    let disposed = false;
    const refresher = () => {
      if (!disposed) onChange(this.merge(bookId));
    };
    const set = this.refreshers.get(bookId) ?? new Set();
    set.add(refresher);
    this.refreshers.set(bookId, set);

    // on-disk outbox → first emission (even offline) → recovery
    this.ensurePending(bookId)
      .then(() => {
        refresher();
        return this.recover(bookId);
      })
      .catch((error) => onError?.(toError(error)));

    const unsub = this.remote.observeNotes(
      bookId,
      (remoteNotes) => {
        this.lastRemote.set(bookId, remoteNotes);
        this.refresh(bookId);
      },
      onError,
    );

    return () => {
      disposed = true;
      set.delete(refresher);
      unsub();
    };
  }

  async getNote(ref: NoteRef): Promise<Note | null> {
    try {
      const remote = await this.remote.getNote(ref);
      if (remote !== null) return remote;
    } catch {
      // remote unreachable: fall back to the outbox
    }
    const map = await this.ensurePending(ref.bookId);
    return map.get(ref.noteId) ?? null;
  }

  async createNote(bookId: string, input: CreateNoteInput): Promise<Note> {
    const at = this.now();
    const note: Note = {
      id: this.remote.newNoteId(bookId),
      bookId,
      schemaVersion: 1,
      text: input.text,
      tag: input.tag ?? null,
      createdAt: at,
      updatedAt: at,
    };
    // durability first: the on-disk outbox is the "real" save
    const map = await this.ensurePending(bookId);
    map.set(note.id, note);
    await this.mirror.savePending(note);
    this.refresh(bookId); // shows up immediately, even offline

    // optimistic sync: on ack removes from the outbox; on rejection stays for recovery
    this.remote
      .putNote(note)
      .then(() => this.confirm(note))
      .catch((error) => this.onError?.(toError(error)));

    return note;
  }

  async updateNote(ref: NoteRef, patch: NotePatch): Promise<void> {
    const map = await this.ensurePending(ref.bookId);
    const existing = map.get(ref.noteId);
    if (existing !== undefined) {
      // note not yet synced: update the copy in the outbox so that
      // recovery re-pushes the corrected version
      const updated: Note = { ...existing, ...patch, updatedAt: this.now() };
      map.set(ref.noteId, updated);
      await this.mirror.savePending(updated);
      this.refresh(ref.bookId);
    }
    await this.remote.updateNote(ref, patch);
  }

  async deleteNote(ref: NoteRef): Promise<void> {
    const map = await this.ensurePending(ref.bookId);
    map.delete(ref.noteId);
    await this.mirror.removePending(ref);
    this.refresh(ref.bookId);
    await this.remote.deleteNote(ref);
  }
}
