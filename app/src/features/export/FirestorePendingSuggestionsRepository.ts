// Count of pending suggestions on Firestore (the chapters'
// `suggestions` subcollection; pre-export warning). They are counted chapter
// by chapter — no collection group: the per-user rules do not provide for it
// and a book's chapters are a few dozen.

import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';

import type { PendingSuggestionsRepository } from './types';

export interface FirestorePendingSuggestionsRepositoryDeps {
  db: Firestore;
  uid: string;
}

export class FirestorePendingSuggestionsRepository implements PendingSuggestionsRepository {
  constructor(private readonly deps: FirestorePendingSuggestionsRepositoryDeps) {}

  async countPending(bookId: string): Promise<number> {
    const { db, uid } = this.deps;
    const chapters = await getDocs(collection(db, 'users', uid, 'books', bookId, 'chapters'));
    const counts = await Promise.all(
      chapters.docs.map(async (chapter) => {
        const pending = await getDocs(
          query(collection(chapter.ref, 'suggestions'), where('state', '==', 'pending')),
        );
        return pending.size;
      }),
    );
    return counts.reduce((total, count) => total + count, 0);
  }
}
