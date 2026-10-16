// Filtering of notes by tag (NotesScreen chips). Pure function: no
// dependency on React or the SDK, so the filter can be tested on its own (70/20/10 pyramid).
// It does not reorder: notes already arrive in chronological order from the
// repository, the filter preserves the order.

import type { Note, NoteTag } from './types';

/** `null` = "Tutte" (no active filter). */
export type NoteFilter = NoteTag | null;

export function filterNotesByTag(notes: readonly Note[], filter: NoteFilter): Note[] {
  if (filter === null) return [...notes];
  return notes.filter((note) => note.tag === filter);
}
