// Outbox LOCALE durabile delle note (feature Taccuino). Il JS SDK di
// Firestore su React Native ha SOLO cache in memoria: una nota creata offline
// vive in RAM e muore con l'app prima del sync. Come per i capitoli (LocalChapterRepository),
// la rete di sicurezza su disco la mette questo modulo:
// ogni nota creata finisce PRIMA in un outbox su AsyncStorage (durabile, Zod al
// confine), poi in Firestore; se il remoto non risponde la nota resta qui e
// viene ri-sincronizzata alla prossima occasione (OfflineFirstNoteRepository).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { NOTE_TAGS } from './types';
import type { Note, NoteRef } from './types';

// dati esterni (qui: disco) validati al confine con Zod (standard tecnici)
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

/** Sottoinsieme di AsyncStorage usato dal repository, iniettabile nei test. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * Outbox delle note non ancora confermate dal server, una voce per libro.
 * Non è un mirror completo del Taccuino: le note già sincronizzate arrivano da
 * Firestore via observe. Qui vivono solo le creazioni in attesa di ack.
 */
export class LocalNoteRepository {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = AsyncStorage) {
    this.storage = storage;
  }

  /** Note in attesa per il libro (array vuoto se nulla o payload illeggibile). */
  async listPending(bookId: string): Promise<Note[]> {
    const raw = await this.storage.getItem(keyFor(bookId));
    if (raw === null) return [];
    const parsed = parseOutbox(raw);
    if (parsed === null) {
      // payload corrotto o di uno schema futuro: non si butta MAI del testo —
      // lo si mette da parte con un timestamp e si riparte da outbox vuoto
      await this.storage.setItem(`${keyFor(bookId)}:quarantena-${Date.now()}`, raw);
      return [];
    }
    return parsed;
  }

  /** Inserisce o aggiorna (per id) una nota in attesa. */
  async savePending(note: Note): Promise<void> {
    const current = await this.listPending(note.bookId);
    const next = current.filter((n) => n.id !== note.id);
    next.push(note);
    await this.write(note.bookId, next);
  }

  /** Toglie una nota dall'outbox (confermata dal server, o cancellata). */
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
