// BookRepository on Firestore. Same rules as
// FirestoreChapterRepository: Zod at the boundary (bookCodec, upgrade-on-read),
// optimistic writes (never wait for the server ack: it does not arrive offline),
// denormalized counters on the book document. reconcileCounters is the
// counters' self-healing: it recomputes from the chapters and fixes the drift
// left by skipped increments (cold offline starts, dead sessions).

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';

import { timestampsToMillis, toError } from '../../lib/firestoreCodec';
import type { Unsubscribe } from '../chapters';
import { decodeBookDoc, newBookDoc, toBook } from './bookCodec';
import type { Book, BookPatch, BookRepository, CreateBookInput } from './types';

/** Firestore batches accept at most 500 operations. */
const BATCH_LIMIT = 500;

export interface FirestoreBookRepositoryOptions {
  db: Firestore;
  /** Owner of the data: everything lives under users/{uid}. */
  uid: string;
  /** Notification of write errors settled by the server (e.g. permissions). */
  onWriteError?: (error: Error) => void;
}

export class FirestoreBookRepository implements BookRepository {
  private readonly db: Firestore;
  private readonly uid: string;
  private readonly onWriteError?: (error: Error) => void;

  constructor(options: FirestoreBookRepositoryOptions) {
    this.db = options.db;
    this.uid = options.uid;
    this.onWriteError = options.onWriteError;
  }

  private booksCol() {
    return collection(this.db, 'users', this.uid, 'books');
  }

  private bookRef(bookId: string) {
    return doc(this.booksCol(), bookId);
  }

  private chaptersCol(bookId: string) {
    return collection(this.bookRef(bookId), 'chapters');
  }

  /** Optimistic write: the server ack is not awaited (see header). */
  private commitInBackground(commit: Promise<unknown>): void {
    commit.catch((error) => {
      const wrapped = toError(error);
      console.warn('Firestore write rejected by the server', wrapped);
      this.onWriteError?.(wrapped);
    });
  }

  private decodeSnapshot(snapshot: DocumentSnapshot): Book | null {
    const data = snapshot.data({ serverTimestamps: 'estimate' });
    if (data === undefined) return null;
    const decoded = decodeBookDoc(timestampsToMillis(data));
    return decoded === null ? null : toBook(snapshot.id, decoded);
  }

  observeBooks(onChange: (books: Book[]) => void, onError?: (error: Error) => void): Unsubscribe {
    const q = query(this.booksCol(), orderBy('updatedAt', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const books: Book[] = [];
        for (const docSnap of snapshot.docs) {
          const book = this.decodeSnapshot(docSnap);
          if (book === null) {
            // non-conforming payload: skip the row without breaking the Library
            console.warn(`Book ${docSnap.id} does not match the schema: skipped`);
            continue;
          }
          books.push(book);
        }
        onChange(books);
      },
      (error) => onError?.(toError(error)),
    );
  }

  observeBook(
    bookId: string,
    onChange: (book: Book | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return onSnapshot(
      this.bookRef(bookId),
      (snapshot) => onChange(this.decodeSnapshot(snapshot)),
      (error) => onError?.(toError(error)),
    );
  }

  async getBook(bookId: string): Promise<Book | null> {
    const snapshot = await getDoc(this.bookRef(bookId));
    if (!snapshot.exists()) return null;
    const book = this.decodeSnapshot(snapshot);
    if (book === null) {
      // document present but unreadable: never confuse "empty" with "broken"
      throw new Error(`Book ${bookId} does not match the schema`);
    }
    return book;
  }

  async createBook(input: CreateBookInput): Promise<Book> {
    const ref = doc(this.booksCol());
    const domainDoc = newBookDoc(input, Date.now());
    this.commitInBackground(
      setDoc(ref, {
        ...domainDoc,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    return toBook(ref.id, domainDoc);
  }

  async updateBook(bookId: string, patch: BookPatch): Promise<void> {
    this.commitInBackground(
      updateDoc(this.bookRef(bookId), { ...patch, updatedAt: serverTimestamp() }),
    );
  }

  async deleteBook(bookId: string): Promise<void> {
    // subcollections are not deleted automatically: chapters first, in batches
    const chapters = await getDocs(this.chaptersCol(bookId));
    const refs = [...chapters.docs.map((docSnap) => docSnap.ref), this.bookRef(bookId)];
    for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
      const batch = writeBatch(this.db);
      for (const ref of refs.slice(start, start + BATCH_LIMIT)) {
        batch.delete(ref);
      }
      this.commitInBackground(batch.commit());
    }
  }

  async reconcileCounters(bookId: string): Promise<void> {
    const [bookSnap, chaptersSnap] = await Promise.all([
      getDoc(this.bookRef(bookId)),
      getDocs(this.chaptersCol(bookId)),
    ]);
    if (!bookSnap.exists()) return;

    let wordCount = 0;
    for (const docSnap of chaptersSnap.docs) {
      const raw = (docSnap.data() as { wordCount?: unknown }).wordCount;
      if (typeof raw === 'number' && Number.isFinite(raw)) wordCount += raw;
    }
    const chapterCount = chaptersSnap.size;

    const data = bookSnap.data({ serverTimestamps: 'estimate' }) as {
      wordCount?: unknown;
      chapterCount?: unknown;
    };
    if (data.wordCount === wordCount && data.chapterCount === chapterCount) return;

    // no updatedAt: this is maintenance, it must not reorder the Library
    this.commitInBackground(updateDoc(this.bookRef(bookId), { wordCount, chapterCount }));
  }
}
