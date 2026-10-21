// Offline-first composite: Firestore + local on-disk mirror.
//
// Why it exists: the Firestore JS SDK on React Native has ONLY the in-memory
// cache (no IndexedDB), so a write queued offline dies with the app.
// Rule: dictated text never lives only in RAM:
// here every save touches the AsyncStorage mirror (durable) FIRST and then
// Firestore; on read the most recent wins, and a mirror fresher than the
// remote is pushed back to Firestore (recovery of a session that died offline).
//
// Coexistence rule: during a session the chapter has a single writer, so
// the updatedAt comparison is post-crash recovery, not conflict resolution
// between devices.

import { countWords } from '../../lib/text';
import type { LocalChapterRepository } from './LocalChapterRepository';
import type {
  Chapter,
  ChapterPatch,
  ChapterRef,
  ChapterRepository,
  ChapterSummary,
  CreateChapterInput,
  SaveOutcome,
  Unsubscribe,
} from './types';

export interface OfflineFirstChapterRepositoryOptions {
  remote: ChapterRepository;
  mirror: LocalChapterRepository;
  /**
   * Words ADDED on every save (positive delta): feeds the daily goal
   * in the Library. Deletions do not subtract words from the
   * motivational count.
   */
  onWordsAdded?: (delta: number) => void;
}

export class OfflineFirstChapterRepository implements ChapterRepository {
  private readonly remote: ChapterRepository;
  private readonly mirror: LocalChapterRepository;
  private readonly onWordsAdded?: (delta: number) => void;
  /** Words of the last text seen per chapter (for the goal deltas). */
  private readonly lastWords = new Map<string, number>();

  constructor(options: OfflineFirstChapterRepositoryOptions) {
    this.remote = options.remote;
    this.mirror = options.mirror;
    this.onWordsAdded = options.onWordsAdded;
  }

  private keyFor(ref: ChapterRef): string {
    return `${ref.bookId}/${ref.chapterId}`;
  }

  async loadRawText(ref: ChapterRef): Promise<string | null> {
    let remoteChapter: Chapter | null = null;
    let remoteFailed = false;
    try {
      remoteChapter = await this.remote.getChapter(ref);
    } catch {
      remoteFailed = true;
    }

    let mirrorEntry = null;
    try {
      mirrorEntry = await this.mirror.loadEntry(ref);
    } catch {
      // unreadable mirror: carry on with the remote only
    }

    if (remoteFailed && mirrorEntry === null) {
      // neither remote nor mirror: this is NOT an empty chapter, it is a failed read;
      // returning null here would restart dictation from zero and overwrite
      throw new Error(`Chapter ${this.keyFor(ref)} unreachable and no local copy`);
    }

    let text: string | null;
    if (mirrorEntry === null) {
      text = remoteChapter === null ? null : remoteChapter.rawText;
    } else if (remoteChapter === null) {
      // the remote responds but no longer has the chapter: restart from the mirror,
      // which will go back up on the next save
      text = mirrorEntry.rawText;
    } else if (
      mirrorEntry.updatedAt > remoteChapter.updatedAt &&
      mirrorEntry.rawText !== remoteChapter.rawText
    ) {
      // recovery: the previous session died offline after the mirror write but
      // before the sync; push the local copy back to Firestore
      text = mirrorEntry.rawText;
      this.remote.saveRawText(ref, mirrorEntry.rawText).catch((error) => {
        console.warn('Mirror recovery to Firestore failed', error);
      });
    } else {
      text = remoteChapter.rawText;
    }

    this.lastWords.set(this.keyFor(ref), countWords(text ?? ''));
    return text;
  }

  async saveRawText(ref: ChapterRef, rawText: string): Promise<SaveOutcome> {
    // durability first: the on-disk mirror is the "real" save;
    // Firestore follows (and offline it stays queued only for the current session)
    await this.mirror.saveRawText(ref, rawText);
    let outcome: SaveOutcome = 'synced';
    try {
      await this.remote.saveRawText(ref, rawText);
    } catch (error) {
      // the text is already safe in the mirror: the remote will catch up on the
      // next save or via the recovery in loadRawText; the UI says so honestly
      console.warn('Firestore save failed (text is safe in the mirror)', error);
      outcome = 'local-only';
    }

    const key = this.keyFor(ref);
    const words = countWords(rawText);
    const previous = this.lastWords.get(key);
    if (previous !== undefined && words > previous) {
      this.onWordsAdded?.(words - previous);
    }
    this.lastWords.set(key, words);
    return outcome;
  }

  // CRUD and subscriptions stay with the remote: the metadata can be
  // rebuilt, and the Library/Book live on observe* (Observer).

  observeChapters(
    bookId: string,
    onChange: (chapters: ChapterSummary[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return this.remote.observeChapters(bookId, onChange, onError);
  }

  observeChapter(
    ref: ChapterRef,
    onChange: (chapter: Chapter | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return this.remote.observeChapter(ref, onChange, onError);
  }

  getChapter(ref: ChapterRef): Promise<Chapter | null> {
    return this.remote.getChapter(ref);
  }

  createChapter(bookId: string, input: CreateChapterInput): Promise<Chapter> {
    return this.remote.createChapter(bookId, input);
  }

  updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void> {
    return this.remote.updateChapter(ref, patch);
  }

  reorderChapters(bookId: string, orderedIds: readonly string[]): Promise<void> {
    return this.remote.reorderChapters(bookId, orderedIds);
  }

  async deleteChapter(ref: ChapterRef): Promise<void> {
    // the orphan mirror entry is harmless (it will be overwritten if the id is reborn),
    // but the session count must be forgotten
    this.lastWords.delete(this.keyFor(ref));
    return this.remote.deleteChapter(ref);
  }
}
