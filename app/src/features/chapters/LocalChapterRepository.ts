// Persistenza LOCALE del testo capitolo su AsyncStorage. Nata come repository
// provvisorio della Dettatura, dalla integrazione Firestore è il MIRROR offline-first che
// affianca Firestore: il JS SDK su React Native ha solo cache in memoria,
// quindi la rete di sicurezza su disco (il testo non vive mai solo
// in RAM, nemmeno tra un riavvio e l'altro) la garantisce questo modulo,
// dentro OfflineFirstChapterRepository.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { ChapterRef, ChapterTextRepository } from './types';

// dati esterni (qui: disco) validati al confine con Zod (standard tecnici)
const storedChapterSchema = z.object({
  schemaVersion: z.literal(1),
  rawText: z.string(),
  updatedAt: z.number(),
});

type StoredChapter = z.infer<typeof storedChapterSchema>;

const keyFor = (ref: ChapterRef) => `bookvoice/chapters/${ref.bookId}/${ref.chapterId}`;

/** Sottoinsieme di AsyncStorage usato dal repository, iniettabile nei test. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Voce del mirror: testo + istante locale dell'ultimo salvataggio. */
export interface MirrorEntry {
  rawText: string;
  updatedAt: number;
}

export class LocalChapterRepository implements ChapterTextRepository {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = AsyncStorage) {
    this.storage = storage;
  }

  async loadRawText(ref: ChapterRef): Promise<string | null> {
    const entry = await this.loadEntry(ref);
    return entry === null ? null : entry.rawText;
  }

  /** Come loadRawText, ma con l'updatedAt che serve al confronto col remoto. */
  async loadEntry(ref: ChapterRef): Promise<MirrorEntry | null> {
    const raw = await this.storage.getItem(keyFor(ref));
    if (raw === null) return null;
    const parsed = parseStored(raw);
    if (parsed === null) {
      // payload corrotto o di uno schema futuro: non si butta MAI del testo —
      // lo si mette da parte con un timestamp e si riparte da capitolo vuoto
      await this.storage.setItem(`${keyFor(ref)}:quarantena-${Date.now()}`, raw);
      return null;
    }
    return { rawText: parsed.rawText, updatedAt: parsed.updatedAt };
  }

  async saveRawText(ref: ChapterRef, rawText: string): Promise<void> {
    const stored: StoredChapter = { schemaVersion: 1, rawText, updatedAt: Date.now() };
    await this.storage.setItem(keyFor(ref), JSON.stringify(stored));
  }
}

function parseStored(raw: string): StoredChapter | null {
  try {
    return storedChapterSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
