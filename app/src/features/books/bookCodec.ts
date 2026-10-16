// Decoding of book documents at the boundary (Zod + upgrade-on-read).
// Pure functions: tests need neither the SDK nor the emulator.

import { getLanguage } from '../../i18n';

import { bookDocSchema } from './types';
import type { Book, BookDoc, CreateBookInput } from './types';

/**
 * Upgrade-on-read: only v1 exists today, so the step is the identity;
 * future migrations (v1 → v2, …) are added here.
 */
export function upgradeBookData(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

/**
 * Validates (and upgrades, if needed) the raw data of a book document.
 * Returns null for non-conforming payloads: the caller decides whether to skip
 * the row (lists) or treat it as an error (single reads).
 */
export function decodeBookDoc(data: Record<string, unknown>): BookDoc | null {
  const parsed = bookDocSchema.safeParse(upgradeBookData(data));
  return parsed.success ? parsed.data : null;
}

export function toBook(id: string, doc: BookDoc): Book {
  return { ...doc, id };
}

/**
 * Starting document for a new book (counters at zero).
 * Dates are set by the repository (serverTimestamp at the boundary).
 */
export function newBookDoc(input: CreateBookInput, nowMillis: number): BookDoc {
  return {
    schemaVersion: 1,
    title: input.title,
    author: input.author ?? '',
    description: '',
    synopsis: '',
    genre: input.genre ?? (getLanguage() === 'it' ? 'Romanzo' : 'Novel'),
    // a new book is born in the interface language (the AI answers in that language)
    language: input.language ?? getLanguage(),
    status: 'draft',
    styleProfileId: null,
    wordCount: 0,
    chapterCount: 0,
    createdAt: nowMillis,
    updatedAt: nowMillis,
  };
}
