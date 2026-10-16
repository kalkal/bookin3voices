// Decoding of chapter documents at the boundary (Zod + upgrade-on-read).
// Pure functions: tests need neither the SDK nor the emulator.

import { chapterDocSchema } from './types';
import type { Chapter, ChapterDoc, ChapterSummary } from './types';

/**
 * Upgrade-on-read: every document carries its own schemaVersion and
 * old documents are lazily upgraded on first read. Today only v1
 * exists, so the step is the identity; when the schema evolves, the
 * `v1 → v2` migration will be added here (and the repository will rewrite the
 * upgraded document).
 */
export function upgradeChapterData(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

/**
 * Validates (and upgrades, if needed) the raw data of a chapter document.
 * Returns null on non-conforming payloads: the caller decides whether to skip
 * the row (lists) or treat it as an error (point reads).
 */
export function decodeChapterDoc(data: Record<string, unknown>): ChapterDoc | null {
  const parsed = chapterDocSchema.safeParse(upgradeChapterData(data));
  return parsed.success ? parsed.data : null;
}

export function toChapter(id: string, bookId: string, doc: ChapterDoc): Chapter {
  return { ...doc, id, bookId };
}

export function toChapterSummary(chapter: Chapter): ChapterSummary {
  const { id, bookId, order, title, status, wordCount, updatedAt } = chapter;
  return { id, bookId, order, title, status, wordCount, updatedAt };
}
