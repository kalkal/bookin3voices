// ChapterRepository on Firestore. Rules followed:
//  - Zod at the boundary: every document read goes through chapterCodec (upgrade-on-read);
//  - optimistic writes: the methods resolve as soon as the mutation is queued
//    in the SDK (latency compensation); waiting for the server ack would block
//    forever when offline. Settled errors arrive on onWriteError;
//  - denormalized counters: every save updates chapter.wordCount and
//    book.wordCount via increment (transactions do not work offline);
//    the delta is computed from the last word count known in the session
//    (during a session the chapter has a SINGLE writer).
//    If the starting count is unknown (cold offline start) the book
//    is left untouched: BookRepository.reconcileCounters takes care of it.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';

import { t } from '../../i18n';
import { timestampsToMillis, toError } from '../../lib/firestoreCodec';
import { countWords } from '../../lib/text';
import { decodeChapterDoc, toChapter, toChapterSummary } from './chapterCodec';
import type {
  Chapter,
  ChapterPatch,
  ChapterRef,
  ChapterRepository,
  ChapterSummary,
  CreateChapterInput,
  Unsubscribe,
} from './types';

export interface FirestoreChapterRepositoryOptions {
  db: Firestore;
  /** Data owner: everything lives under users/{uid}. */
  uid: string;
  /**
   * Notification of write errors settled by the server (e.g. permissions).
   * The text is not lost anyway: it stays in the offline-first local mirror.
   */
  onWriteError?: (error: Error) => void;
}

export class FirestoreChapterRepository implements ChapterRepository {
  private readonly db: Firestore;
  private readonly uid: string;
  private readonly onWriteError?: (error: Error) => void;
  /** Last known word count per chapter, for the book.wordCount deltas. */
  private readonly lastKnownWords = new Map<string, number>();

  constructor(options: FirestoreChapterRepositoryOptions) {
    this.db = options.db;
    this.uid = options.uid;
    this.onWriteError = options.onWriteError;
  }

  private bookRef(bookId: string) {
    return doc(this.db, 'users', this.uid, 'books', bookId);
  }

  private chaptersCol(bookId: string) {
    return collection(this.db, 'users', this.uid, 'books', bookId, 'chapters');
  }

  private chapterRef(ref: ChapterRef) {
    return doc(this.chaptersCol(ref.bookId), ref.chapterId);
  }

  private keyFor(ref: ChapterRef): string {
    return `${ref.bookId}/${ref.chapterId}`;
  }

  /** Optimistic write: the server ack is not awaited (see header). */
  private commitInBackground(commit: Promise<unknown>): void {
    commit.catch((error) => {
      const wrapped = toError(error);
      console.warn('Firestore write rejected by the server', wrapped);
      this.onWriteError?.(wrapped);
    });
  }

  private decodeSnapshot(snapshot: DocumentSnapshot, ref: ChapterRef): Chapter | null {
    const data = snapshot.data({ serverTimestamps: 'estimate' });
    if (data === undefined) return null;
    const decoded = decodeChapterDoc(timestampsToMillis(data));
    if (decoded === null) return null;
    return toChapter(ref.chapterId, ref.bookId, decoded);
  }

  observeChapters(
    bookId: string,
    onChange: (chapters: ChapterSummary[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    const q = query(this.chaptersCol(bookId), orderBy('order', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const chapters: ChapterSummary[] = [];
        for (const docSnap of snapshot.docs) {
          const chapter = this.decodeSnapshot(docSnap, { bookId, chapterId: docSnap.id });
          if (chapter === null) {
            // non-conforming payload: skip the row without breaking the list
            console.warn(`Chapter ${bookId}/${docSnap.id} does not match the schema: skipped`);
            continue;
          }
          chapters.push(toChapterSummary(chapter));
        }
        onChange(chapters);
      },
      (error) => onError?.(toError(error)),
    );
  }

  observeChapter(
    ref: ChapterRef,
    onChange: (chapter: Chapter | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      this.chapterRef(ref),
      (snapshot) => onChange(this.decodeSnapshot(snapshot, ref)),
      (error) => onError?.(toError(error)),
    );
  }

  async getChapter(ref: ChapterRef): Promise<Chapter | null> {
    const snapshot = await getDoc(this.chapterRef(ref));
    if (!snapshot.exists()) return null;
    const chapter = this.decodeSnapshot(snapshot, ref);
    if (chapter === null) {
      // document present but unreadable: never confuse "empty" with "broken"
      throw new Error(`Chapter ${this.keyFor(ref)} does not match the schema`);
    }
    this.lastKnownWords.set(this.keyFor(ref), countWords(chapter.rawText));
    return chapter;
  }

  async loadRawText(ref: ChapterRef): Promise<string | null> {
    const chapter = await this.getChapter(ref);
    return chapter === null ? null : chapter.rawText;
  }

  async saveRawText(ref: ChapterRef, rawText: string): Promise<void> {
    const words = countWords(rawText);
    const key = this.keyFor(ref);
    const previous = this.lastKnownWords.get(key);

    const batch = writeBatch(this.db);
    batch.update(this.chapterRef(ref), {
      rawText,
      wordCount: words,
      updatedAt: serverTimestamp(),
    });
    if (previous !== undefined && words !== previous) {
      batch.update(this.bookRef(ref.bookId), {
        wordCount: increment(words - previous),
        updatedAt: serverTimestamp(),
      });
    }
    this.lastKnownWords.set(key, words);
    this.commitInBackground(batch.commit());
  }

  async createChapter(bookId: string, input: CreateChapterInput): Promise<Chapter> {
    const order = await this.nextOrder(bookId);
    const chapterRef = doc(this.chaptersCol(bookId));
    const now = Date.now();

    const batch = writeBatch(this.db);
    batch.set(chapterRef, {
      schemaVersion: 1,
      order,
      title: input.title,
      status: 'draft',
      wordCount: 0,
      rawText: '',
      outline: input.outline ?? null,
      updatedAt: serverTimestamp(),
    });
    batch.update(this.bookRef(bookId), {
      chapterCount: increment(1),
      updatedAt: serverTimestamp(),
    });
    this.commitInBackground(batch.commit());

    const chapter: Chapter = {
      id: chapterRef.id,
      bookId,
      schemaVersion: 1,
      order,
      title: input.title,
      status: 'draft',
      wordCount: 0,
      rawText: '',
      outline: input.outline ?? null,
      updatedAt: now,
    };
    this.lastKnownWords.set(this.keyFor({ bookId, chapterId: chapterRef.id }), 0);
    return chapter;
  }

  /**
   * Next `order` (end of the list). If the read fails (cold offline start,
   * empty cache) we fall back to an epoch-based order that still lands
   * at the end: the next reorder renormalizes it to 0..n-1.
   */
  private async nextOrder(bookId: string): Promise<number> {
    try {
      const snapshot = await getDocs(
        query(this.chaptersCol(bookId), orderBy('order', 'desc'), limit(1)),
      );
      const top = snapshot.docs[0];
      if (top === undefined) return 0;
      const order = (top.data() as { order?: unknown }).order;
      return typeof order === 'number' && Number.isFinite(order) ? Math.floor(order) + 1 : 0;
    } catch {
      return Date.now();
    }
  }

  async updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void> {
    this.commitInBackground(
      updateDoc(this.chapterRef(ref), { ...patch, updatedAt: serverTimestamp() }),
    );
  }

  async reorderChapters(bookId: string, orderedIds: readonly string[]): Promise<void> {
    const snapshot = await getDocs(this.chaptersCol(bookId));
    const existing = new Set(snapshot.docs.map((docSnap) => docSnap.id));
    if (existing.size !== orderedIds.length || orderedIds.some((id) => !existing.has(id))) {
      throw new Error(t('chapters.reorderMismatch'));
    }

    const batch = writeBatch(this.db);
    orderedIds.forEach((chapterId, index) => {
      batch.update(this.chapterRef({ bookId, chapterId }), {
        order: index,
        updatedAt: serverTimestamp(),
      });
    });
    this.commitInBackground(batch.commit());
  }

  async deleteChapter(ref: ChapterRef): Promise<void> {
    // words to subtract from the book: from the document if readable, otherwise
    // from the last session count; reconcileCounters covers the rest
    let words: number | undefined;
    try {
      const snapshot = await getDoc(this.chapterRef(ref));
      const data = snapshot.data({ serverTimestamps: 'estimate' });
      const raw = data === undefined ? undefined : (data as { wordCount?: unknown }).wordCount;
      if (typeof raw === 'number' && Number.isFinite(raw)) words = raw;
    } catch {
      words = this.lastKnownWords.get(this.keyFor(ref));
    }

    const batch = writeBatch(this.db);
    batch.delete(this.chapterRef(ref));
    batch.update(this.bookRef(ref.bookId), {
      chapterCount: increment(-1),
      wordCount: increment(-(words ?? 0)),
      updatedAt: serverTimestamp(),
    });
    this.lastKnownWords.delete(this.keyFor(ref));
    this.commitInBackground(batch.commit());
  }
}
