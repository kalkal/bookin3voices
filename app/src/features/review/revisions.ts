// Sottocollezione `revisions` : patch accettate/rifiutate
// {span, before, after, decision, at} — storico consultabile e dataset per il
// tuning. Repository pattern come per i capitoli: implementazione
// LOCALE e PROVVISORIA su AsyncStorage, l'integrazione Firestore la sostituirà con
// Firestore senza toccare la UI.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { ChapterRef, KeyValueStorage } from '../chapters';
import type { RevisionRecord } from './ReviewSession';
import { spanSchema } from './types';

// dati esterni (disco oggi, Firestore domani) validati al confine con Zod
const revisionRecordSchema = z.object({
  id: z.string().min(1),
  span: spanSchema,
  before: z.string(),
  after: z.string(),
  decision: z.enum(['accepted', 'rejected']),
  at: z.number(),
});

const storedRevisionsSchema = z.object({
  schemaVersion: z.literal(1),
  revisions: z.array(revisionRecordSchema),
});

export interface RevisionRepository {
  /** Revisioni del capitolo in ordine di registrazione. */
  list(ref: ChapterRef): Promise<RevisionRecord[]>;
  append(ref: ChapterRef, revision: RevisionRecord): Promise<void>;
  /** Toglie una revisione annullata con l'undo. */
  remove(ref: ChapterRef, revisionId: string): Promise<void>;
}

const keyFor = (ref: ChapterRef) => `bookvoice/revisions/${ref.bookId}/${ref.chapterId}`;

export class LocalRevisionRepository implements RevisionRepository {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = AsyncStorage) {
    this.storage = storage;
  }

  async list(ref: ChapterRef): Promise<RevisionRecord[]> {
    return this.load(ref);
  }

  async append(ref: ChapterRef, revision: RevisionRecord): Promise<void> {
    const revisions = await this.load(ref);
    revisions.push(revision);
    await this.save(ref, revisions);
  }

  async remove(ref: ChapterRef, revisionId: string): Promise<void> {
    const revisions = await this.load(ref);
    await this.save(
      ref,
      revisions.filter((r) => r.id !== revisionId),
    );
  }

  private async load(ref: ChapterRef): Promise<RevisionRecord[]> {
    const raw = await this.storage.getItem(keyFor(ref));
    if (raw === null) return [];
    try {
      return storedRevisionsSchema.parse(JSON.parse(raw)).revisions;
    } catch {
      // corrotto o schema futuro: lo storico è dataset di tuning, non si
      // butta — quarantena col timestamp come per i capitoli
      await this.storage.setItem(`${keyFor(ref)}:quarantena-${Date.now()}`, raw);
      return [];
    }
  }

  private async save(ref: ChapterRef, revisions: RevisionRecord[]): Promise<void> {
    await this.storage.setItem(keyFor(ref), JSON.stringify({ schemaVersion: 1, revisions }));
  }
}

/** Repository in memoria per test e sviluppo, come InMemoryChapterRepository. */
export class InMemoryRevisionRepository implements RevisionRepository {
  private readonly byChapter = new Map<string, RevisionRecord[]>();

  async list(ref: ChapterRef): Promise<RevisionRecord[]> {
    return [...(this.byChapter.get(keyFor(ref)) ?? [])];
  }

  async append(ref: ChapterRef, revision: RevisionRecord): Promise<void> {
    const revisions = this.byChapter.get(keyFor(ref)) ?? [];
    revisions.push(revision);
    this.byChapter.set(keyFor(ref), revisions);
  }

  async remove(ref: ChapterRef, revisionId: string): Promise<void> {
    const revisions = this.byChapter.get(keyFor(ref)) ?? [];
    this.byChapter.set(
      keyFor(ref),
      revisions.filter((r) => r.id !== revisionId),
    );
  }
}
