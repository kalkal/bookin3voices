// BookRepository su Firestore. Stesse regole del
// FirestoreChapterRepository: Zod al confine (bookCodec, upgrade-on-read),
// scritture ottimistiche (mai attendere l'ack del server: offline non arriva),
// contatori denormalizzati sul documento libro. reconcileCounters è il
// self-healing dei contatori: ricalcola dai capitoli e corregge le derive
// lasciate dagli increment saltati (avvii offline a freddo, sessioni morte).

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

/** I batch Firestore accettano al massimo 500 operazioni. */
const BATCH_LIMIT = 500;

export interface FirestoreBookRepositoryOptions {
  db: Firestore;
  /** Proprietario dei dati: tutto vive sotto users/{uid}. */
  uid: string;
  /** Notifica degli errori di scrittura consolidati dal server (es. permessi). */
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

  /** Scrittura ottimistica: non si attende l'ack del server (vedi testata). */
  private commitInBackground(commit: Promise<unknown>): void {
    commit.catch((error) => {
      const wrapped = toError(error);
      console.warn('Scrittura Firestore rifiutata dal server', wrapped);
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
            // payload non conforme: si salta la riga senza rompere la Libreria
            console.warn(`Libro ${docSnap.id} non conforme allo schema: saltato`);
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
      // documento presente ma illeggibile: mai confondere "vuoto" con "rotto"
      throw new Error(`Libro ${bookId} non conforme allo schema`);
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
    // le sottocollezioni non si eliminano da sole: prima i capitoli, a lotti
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

    // niente updatedAt: è manutenzione, non deve riordinare la Libreria
    this.commitInBackground(updateDoc(this.bookRef(bookId), { wordCount, chapterCount }));
  }
}
