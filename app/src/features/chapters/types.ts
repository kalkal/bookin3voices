// Chapter access contract (Repository pattern): the UI never
// imports the persistence SDK. Two contract levels:
//  - ChapterTextRepository: the minimum Dictation and Editor need,
//    loading and saving the raw text;
//  - ChapterRepository: the full contract (CRUD, reordering
//    and `observe*` subscriptions), implemented on Firestore.

import { z } from 'zod';

/** Coordinates of a chapter within a book (mirrors the document path). */
export interface ChapterRef {
  bookId: string;
  chapterId: string;
}

/** Chapter states: draft → refined → final. */
export const CHAPTER_STATUSES = ['draft', 'refined', 'final'] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

/**
 * Chapter track generated from the synopsis outline:
 * summary and main beats. The proposed title lives in the chapter's own
 * `title`. Shown in dictation as the track.
 */
export const chapterOutlineSchema = z.object({
  summary: z.string(),
  beats: z.array(z.string()),
  /**
   * Indices (0-based) of the beats ticked in dictation: a purely visual
   * "covered" mark, no automation. Additive like `outline`: documents
   * born earlier normalize to [] without a schemaVersion bump. It lives INSIDE
   * the outline so that regenerating the track restarts with the beats to do.
   */
  beatsDone: z.array(z.number().int().min(0)).default([]),
});

export type ChapterOutline = z.infer<typeof chapterOutlineSchema>;

/**
 * Chapter document as it lives on Firestore, validated at the boundary.
 * `updatedAt` travels in the domain as epoch milliseconds: the SDK types
 * (Timestamp) never leave the repository.
 * `outline` is additive: documents born earlier do not have it,
 * the default normalizes them to null without a schemaVersion bump.
 */
export const chapterDocSchema = z.object({
  schemaVersion: z.literal(1),
  order: z.number().int().min(0),
  title: z.string(),
  status: z.enum(CHAPTER_STATUSES),
  wordCount: z.number().int().min(0),
  rawText: z.string(),
  outline: chapterOutlineSchema.nullable().default(null),
  updatedAt: z.number(),
});

export type ChapterDoc = z.infer<typeof chapterDocSchema>;

/** Full chapter (document + coordinates), for editor and dictation. */
export interface Chapter extends ChapterDoc {
  id: string;
  bookId: string;
}

/**
 * Row of the chapter list (Chapters tab of the Book). No rawText:
 * the list must not depend on the full text.
 */
export interface ChapterSummary {
  id: string;
  bookId: string;
  order: number;
  title: string;
  status: ChapterStatus;
  wordCount: number;
  updatedAt: number;
}

/** Editable fields of a chapter (text goes through saveRawText). */
export interface ChapterPatch {
  title?: string;
  status?: ChapterStatus;
  outline?: ChapterOutline | null;
}

export interface CreateChapterInput {
  title: string;
  /** Track from the outline; absent = chapter without an outline. */
  outline?: ChapterOutline;
}

/**
 * Where a save landed: 'synced' = on the phone AND handed to the cloud;
 * 'local-only' = safe on the phone, the cloud will catch up later.
 */
export type SaveOutcome = 'synced' | 'local-only';

/**
 * Minimal contract used by Dictation and Editor: raw text only.
 * Screens that write text depend on this, not on the full CRUD.
 */
export interface ChapterTextRepository {
  /**
   * Raw chapter text, or null if the chapter was never saved.
   * A read error is an exception: never confuse "empty" with "broken".
   */
  loadRawText(ref: ChapterRef): Promise<string | null>;
  /**
   * Replaces the chapter's raw text (source of truth). Resolves only once the
   * text is stored; an implementation that knows the text stayed on the phone
   * says so with 'local-only' (void = stored).
   */
  saveRawText(ref: ChapterRef, rawText: string): Promise<SaveOutcome | void>;
}

/** Stops an observe* subscription (Observer). */
export type Unsubscribe = () => void;

/**
 * Full contract. Writes are optimistic
 * (Optimistic UI): they resolve as soon as the mutation is taken over by the
 * persistence layer; the settled outcome arrives from the observe* methods.
 */
export interface ChapterRepository extends ChapterTextRepository {
  /** List ordered by `order`; re-emitted on every change. */
  observeChapters(
    bookId: string,
    onChange: (chapters: ChapterSummary[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
  observeChapter(
    ref: ChapterRef,
    onChange: (chapter: Chapter | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
  getChapter(ref: ChapterRef): Promise<Chapter | null>;
  /** Creates at the end (order = max + 1) and increments book.chapterCount. */
  createChapter(bookId: string, input: CreateChapterInput): Promise<Chapter>;
  updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void>;
  /**
   * Rewrites `order` according to the order of the ids received (drag & drop).
   * Missing or foreign ids are an error: reordering is total, never partial.
   */
  reorderChapters(bookId: string, orderedIds: readonly string[]): Promise<void>;
  /** Deletes the chapter and updates the book's denormalized counters. */
  deleteChapter(ref: ChapterRef): Promise<void>;
}
