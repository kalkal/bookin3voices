// LOCAL persistence of chapter text on AsyncStorage. Born as the Dictation's
// provisional repository, since the Firestore integration it is the offline-first MIRROR
// that sits alongside Firestore: the JS SDK on React Native has only an in-memory
// cache, so this module, inside OfflineFirstChapterRepository, provides the
// on-disk safety net (text never lives only in RAM, not even across restarts).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { ChapterRef, ChapterTextRepository } from './types';

// external data (here: disk) validated at the boundary with Zod
const storedChapterSchema = z.object({
  schemaVersion: z.literal(1),
  rawText: z.string(),
  updatedAt: z.number(),
});

type StoredChapter = z.infer<typeof storedChapterSchema>;

const keyFor = (ref: ChapterRef) => `bookvoice/chapters/${ref.bookId}/${ref.chapterId}`;

/** Subset of AsyncStorage used by the repository, injectable in tests. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Mirror entry: text + local time of the last save. */
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

  /** Like loadRawText, but with the updatedAt needed for the comparison with the remote. */
  async loadEntry(ref: ChapterRef): Promise<MirrorEntry | null> {
    const raw = await this.storage.getItem(keyFor(ref));
    if (raw === null) return null;
    const parsed = parseStored(raw);
    if (parsed === null) {
      // corrupt payload or future schema: text is NEVER thrown away;
      // set it aside with a timestamp and start over from an empty chapter
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
