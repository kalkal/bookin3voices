// Decoding of note documents at the boundary (Zod + upgrade-on-read).
// Pure functions: tests need neither the SDK nor the emulator.

import { noteDocSchema } from './types';
import type { Note, NoteDoc } from './types';

/**
 * Upgrade-on-read: every document carries its own schemaVersion and
 * old documents are lazily upgraded on first read. Only v1 exists
 * today, so the step is the identity; when the schema evolves, the `v1 → v2`
 * migration will be added here (and the repository will rewrite the
 * upgraded document).
 */
export function upgradeNoteData(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

/**
 * Validates (and upgrades, if needed) the raw data of a note document.
 * Returns null for non-conforming payloads: the caller decides whether to skip
 * the row (lists) or treat it as an error (single reads).
 */
export function decodeNoteDoc(data: Record<string, unknown>): NoteDoc | null {
  const parsed = noteDocSchema.safeParse(upgradeNoteData(data));
  return parsed.success ? parsed.data : null;
}

export function toNote(id: string, bookId: string, doc: NoteDoc): Note {
  return { ...doc, id, bookId };
}
