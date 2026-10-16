// `revisions` subcollection: accepted/rejected patches
// {span, before, after, decision, at}: a browsable history and a dataset for
// tuning. Repository pattern as for chapters: a LOCAL and PROVISIONAL
// implementation on AsyncStorage; the Firestore integration will replace it
// without touching the UI.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { ChapterRef, KeyValueStorage } from '../chapters';
import type { RevisionRecord } from './ReviewSession';
import { spanSchema } from './types';

// external data (disk today, Firestore tomorrow) validated at the boundary with Zod
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
  /** Chapter revisions in order of recording. */
  list(ref: ChapterRef): Promise<RevisionRecord[]>;
  append(ref: ChapterRef, revision: RevisionRecord): Promise<void>;
  /** Removes a revision cancelled by undo. */
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
      // corrupt or future schema: the history is a tuning dataset, so it is
      // not thrown away; quarantine it with a timestamp, as for chapters
      await this.storage.setItem(`${keyFor(ref)}:quarantena-${Date.now()}`, raw);
      return [];
    }
  }

  private async save(ref: ChapterRef, revisions: RevisionRecord[]): Promise<void> {
    await this.storage.setItem(keyFor(ref), JSON.stringify({ schemaVersion: 1, revisions }));
  }
}

/** In-memory repository for tests and development, like InMemoryChapterRepository. */
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
