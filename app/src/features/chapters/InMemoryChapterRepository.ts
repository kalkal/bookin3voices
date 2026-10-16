// Repository in memoria per test e sviluppo: contratto completo
// (CRUD + observe*), più qualche contatore per le asserzioni sui salvataggi
// (debounce, flush) usato dai test della Dettatura.

import { countWords } from '../../lib/text';
import { toChapterSummary } from './chapterCodec';
import type {
  Chapter,
  ChapterPatch,
  ChapterRef,
  ChapterRepository,
  ChapterSummary,
  CreateChapterInput,
  Unsubscribe,
} from './types';

const keyFor = (ref: ChapterRef) => `${ref.bookId}/${ref.chapterId}`;

export class InMemoryChapterRepository implements ChapterRepository {
  private readonly chapters = new Map<string, Chapter>();
  private readonly listListeners = new Map<string, Set<(chapters: ChapterSummary[]) => void>>();
  private readonly docListeners = new Map<string, Set<(chapter: Chapter | null) => void>>();
  private nextId = 1;
  /** Cronologia dei testi salvati, in ordine (per asserire debounce e flush). */
  readonly savedTexts: string[] = [];
  /** Se impostato, il prossimo saveRawText fallisce con questo errore. */
  nextSaveError?: Error;

  async loadRawText(ref: ChapterRef): Promise<string | null> {
    return this.chapters.get(keyFor(ref))?.rawText ?? null;
  }

  async saveRawText(ref: ChapterRef, rawText: string): Promise<void> {
    if (this.nextSaveError) {
      const error = this.nextSaveError;
      this.nextSaveError = undefined;
      throw error;
    }
    const existing = this.chapters.get(keyFor(ref)) ?? this.blankChapter(ref);
    this.chapters.set(keyFor(ref), {
      ...existing,
      rawText,
      wordCount: countWords(rawText),
      updatedAt: Date.now(),
    });
    this.savedTexts.push(rawText);
    this.emit(ref.bookId);
  }

  /** Comodo per preparare lo stato iniziale nei test. */
  seed(ref: ChapterRef, rawText: string, extra?: Partial<Chapter>): Chapter {
    const chapter: Chapter = {
      ...this.blankChapter(ref),
      rawText,
      wordCount: countWords(rawText),
      ...extra,
    };
    this.chapters.set(keyFor(ref), chapter);
    this.emit(ref.bookId);
    return chapter;
  }

  observeChapters(bookId: string, onChange: (chapters: ChapterSummary[]) => void): Unsubscribe {
    const listeners = this.listListeners.get(bookId) ?? new Set();
    listeners.add(onChange);
    this.listListeners.set(bookId, listeners);
    onChange(this.listOf(bookId));
    return () => listeners.delete(onChange);
  }

  observeChapter(ref: ChapterRef, onChange: (chapter: Chapter | null) => void): Unsubscribe {
    const listeners = this.docListeners.get(keyFor(ref)) ?? new Set();
    listeners.add(onChange);
    this.docListeners.set(keyFor(ref), listeners);
    onChange(this.chapters.get(keyFor(ref)) ?? null);
    return () => listeners.delete(onChange);
  }

  async getChapter(ref: ChapterRef): Promise<Chapter | null> {
    return this.chapters.get(keyFor(ref)) ?? null;
  }

  async createChapter(bookId: string, input: CreateChapterInput): Promise<Chapter> {
    const order = this.listOf(bookId).length;
    const ref = { bookId, chapterId: `capitolo-${this.nextId++}` };
    const chapter: Chapter = {
      ...this.blankChapter(ref),
      title: input.title,
      order,
      outline: input.outline ?? null,
    };
    this.chapters.set(keyFor(ref), chapter);
    this.emit(bookId);
    return chapter;
  }

  async updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void> {
    const existing = this.chapters.get(keyFor(ref));
    if (!existing) throw new Error(`Capitolo inesistente: ${keyFor(ref)}`);
    this.chapters.set(keyFor(ref), { ...existing, ...patch, updatedAt: Date.now() });
    this.emit(ref.bookId);
  }

  async reorderChapters(bookId: string, orderedIds: readonly string[]): Promise<void> {
    const current = this.listOf(bookId);
    const existing = new Set(current.map((chapter) => chapter.id));
    if (existing.size !== orderedIds.length || orderedIds.some((id) => !existing.has(id))) {
      throw new Error('Riordino non totale: gli id non coincidono con i capitoli del libro');
    }
    orderedIds.forEach((chapterId, index) => {
      const ref = { bookId, chapterId };
      const chapter = this.chapters.get(keyFor(ref));
      if (chapter) this.chapters.set(keyFor(ref), { ...chapter, order: index });
    });
    this.emit(bookId);
  }

  async deleteChapter(ref: ChapterRef): Promise<void> {
    this.chapters.delete(keyFor(ref));
    this.emit(ref.bookId);
  }

  private blankChapter(ref: ChapterRef): Chapter {
    return {
      id: ref.chapterId,
      bookId: ref.bookId,
      schemaVersion: 1,
      order: 0,
      title: '',
      status: 'draft',
      wordCount: 0,
      rawText: '',
      outline: null,
      updatedAt: Date.now(),
    };
  }

  private listOf(bookId: string): Chapter[] {
    return [...this.chapters.values()]
      .filter((chapter) => chapter.bookId === bookId)
      .sort((a, b) => a.order - b.order);
  }

  private emit(bookId: string): void {
    const summaries = this.listOf(bookId).map(toChapterSummary);
    for (const listener of this.listListeners.get(bookId) ?? []) listener(summaries);
    for (const [key, listeners] of this.docListeners) {
      if (!key.startsWith(`${bookId}/`)) continue;
      const chapter = this.chapters.get(key) ?? null;
      for (const listener of listeners) listener(chapter);
    }
  }
}
