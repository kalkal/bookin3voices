// Composito offline-first delle note (feature Taccuino, review F2). Stessa rete
// di sicurezza dei capitoli (OfflineFirstChapterRepository): la cache del JS SDK
// di Firestore su React Native è solo in memoria, quindi una nota creata offline
// morirebbe con l'app prima del sync. Qui ogni creazione tocca PRIMA l'outbox
// durabile (LocalNoteRepository su AsyncStorage) e POI Firestore in modo
// ottimistico; se il remoto rifiuta/è offline la nota resta nell'outbox e viene
// ri-sincronizzata (recovery) alla prossima apertura/observe. Le note già
// sincronizzate arrivano da Firestore via observe; la vista è l'unione delle due
// sorgenti, deduplicata per id (il remoto vince). Obiettivo: una nota salvata non
// si perde mai, nemmeno offline con l'app uccisa.

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
  /** Errori consolidati (es. permessi) dal tentativo di sync ottimistico. */
  onError?: (error: Error) => void;
  /** Orologio iniettabile per test deterministici. */
  now?: () => number;
}

export class OfflineFirstNoteRepository implements NoteRepository {
  private readonly remote: SyncableNoteRepository;
  private readonly mirror: LocalNoteRepository;
  private readonly onError?: (error: Error) => void;
  private readonly now: () => number;

  /** Note in attesa in memoria, per libro (specchio dell'outbox su disco). */
  private readonly pending = new Map<string, Map<string, Note>>();
  /** Outbox già caricato da disco per questo libro (una sola lettura). */
  private readonly loaded = new Set<string>();
  /** Ultima emissione del remoto, per libro (base della fusione). */
  private readonly lastRemote = new Map<string, Note[]>();
  /** Ri-emissioni attive, per libro: le chiama chi cambia lo stato. */
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

  /** Vista fusa: remoto ∪ outbox, deduplicata per id (remoto vince), desc. */
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

  /** Ri-spinge verso il remoto le note in attesa (recovery della sessione morta). */
  private async recover(bookId: string): Promise<void> {
    const map = await this.ensurePending(bookId);
    for (const note of [...map.values()]) {
      // putNote risolve solo all'ack del server: offline resta pending (durabile),
      // online conferma e sfila dall'outbox. Idempotente (stesso id): niente doppioni.
      this.remote
        .putNote(note)
        .then(() => this.confirm(note))
        .catch(() => {
          // ancora irraggiungibile: la nota resta nell'outbox per il prossimo giro
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

    // outbox su disco → prima emissione (anche offline) → recovery
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
      // remoto irraggiungibile: si ripiega sull'outbox
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
    // durabilità prima di tutto: l'outbox su disco è il salvataggio "vero"
    const map = await this.ensurePending(bookId);
    map.set(note.id, note);
    await this.mirror.savePending(note);
    this.refresh(bookId); // compare subito, anche offline

    // sync ottimistico: on ack sfila dall'outbox; su rifiuto resta per la recovery
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
      // nota ancora non sincronizzata: si aggiorna la copia nell'outbox così la
      // recovery ri-spinge la versione corretta
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
