// ChapterRepository su Firestore. Regole seguite:
//  - Zod al confine: ogni documento letto passa da chapterCodec (upgrade-on-read);
//  - scritture ottimistiche: i metodi risolvono appena la mutazione è in coda
//    nell'SDK (latency compensation) — attendere l'ack del server bloccherebbe
//    per sempre offline. Gli errori consolidati arrivano su onWriteError;
//  - contatori denormalizzati: ogni salvataggio aggiorna chapter.wordCount e
//    book.wordCount via increment (le transazioni non funzionano offline);
//    il delta si calcola dall'ultimo conteggio noto in sessione (regola di
//    convivenza 2: durante una sessione il capitolo ha UN solo scrittore).
//    Se il conteggio di partenza non è noto (avvio offline a freddo) il libro
//    non viene toccato: ci pensa BookRepository.reconcileCounters.

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
  /** Proprietario dei dati: tutto vive sotto users/{uid}. */
  uid: string;
  /**
   * Notifica degli errori di scrittura consolidati dal server (es. permessi).
   * Il testo non si perde comunque: resta nel mirror locale offline-first.
   */
  onWriteError?: (error: Error) => void;
}

export class FirestoreChapterRepository implements ChapterRepository {
  private readonly db: Firestore;
  private readonly uid: string;
  private readonly onWriteError?: (error: Error) => void;
  /** Ultimo conteggio parole noto per capitolo, per i delta di book.wordCount. */
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

  /** Scrittura ottimistica: non si attende l'ack del server (vedi testata). */
  private commitInBackground(commit: Promise<unknown>): void {
    commit.catch((error) => {
      const wrapped = toError(error);
      console.warn('Scrittura Firestore rifiutata dal server', wrapped);
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
            // payload non conforme: si salta la riga senza rompere la lista
            console.warn(`Capitolo ${bookId}/${docSnap.id} non conforme allo schema: saltato`);
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
      // documento presente ma illeggibile: mai confondere "vuoto" con "rotto"
      throw new Error(`Capitolo ${this.keyFor(ref)} non conforme allo schema`);
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
   * Prossimo `order` (coda della lista). Se la lettura fallisce (avvio offline
   * a freddo, cache vuota) si ripiega su un ordine-epoch che finisce comunque
   * in coda: il prossimo riordino lo rinormalizza a 0..n-1.
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
    // parole da scalare dal libro: dal documento se leggibile, altrimenti
    // dall'ultimo conteggio di sessione; reconcileCounters copre il resto
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
