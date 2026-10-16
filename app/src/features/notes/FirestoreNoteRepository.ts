// NoteRepository su Firestore (feature Taccuino). Clona le regole
// di FirestoreChapterRepository:
//  - Zod al confine: ogni documento letto passa da noteCodec (upgrade-on-read);
//  - scritture ottimistiche: i metodi risolvono appena la mutazione è in coda
//    nell'SDK (latency compensation) — attendere l'ack del server bloccherebbe
//    per sempre offline. Gli errori consolidati arrivano su onWriteError;
//  - niente contatori denormalizzati: le note NON entrano nel conteggio del
//    libro (materiale a lato), quindi nessun increment su books/{bookId};
//  - ordine cronologico: orderBy createdAt desc (più recenti in cima).

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
  /** Proprietario dei dati: tutto vive sotto users/{uid}. */
  uid: string;
  /**
   * Notifica degli errori di scrittura consolidati dal server (es. permessi).
   * La nota non si perde comunque: resta nella cache locale offline dell'SDK.
   */
  onWriteError?: (error: Error) => void;
}

/**
 * Remote che il composito offline-first (OfflineFirstNoteRepository) sa
 * ri-sincronizzare: oltre al contratto NoteRepository serve poter coniare un id
 * PRIMA di scrivere (così l'outbox durabile e il server concordano) e riscrivere
 * una nota con id/createdAt noti in modo idempotente (recovery della sessione
 * morta offline). Nessun impatto sulla UI, che dipende solo da NoteRepository.
 */
export interface SyncableNoteRepository extends NoteRepository {
  /** Conia un id documento (senza scrivere): serve all'outbox locale. */
  newNoteId(bookId: string): string;
  /** (Ri)scrive una nota con id/createdAt noti; risolve all'ack del server. */
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

  /** Scrittura ottimistica: non si attende l'ack del server (vedi testata). */
  private commitInBackground(commit: Promise<unknown>): void {
    commit.catch((error) => {
      const wrapped = toError(error);
      console.warn('Scrittura Firestore (nota) rifiutata dal server', wrapped);
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
            // payload non conforme: si salta la riga senza rompere la lista
            console.warn(`Nota ${bookId}/${docSnap.id} non conforme allo schema: saltata`);
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
      // documento presente ma illeggibile: mai confondere "vuoto" con "rotto"
      throw new Error(`Nota ${this.keyFor(ref)} non conforme allo schema`);
    }
    return note;
  }

  newNoteId(bookId: string): string {
    return doc(this.notesCol(bookId)).id;
  }

  /**
   * Scrive il documento con id noto. `createdAt` è un valore client (millisecondi):
   * observeNotes ordina su createdAt, quindi un valore già risolto evita che la
   * nota "salti" in fondo finché il server non risolve il sentinel (latency
   * compensation), e coincide con la nota restituita ottimisticamente.
   * `updatedAt` resta serverTimestamp: è la data autorevole dell'ultima modifica.
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
    // idempotente: la recovery può richiamarla senza creare duplicati (stesso id)
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
