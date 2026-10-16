// Filtro delle note per tag (chip della NotesScreen). Funzione pura: nessuna
// dipendenza da React o dall'SDK, così il filtro si prova da solo (piramide 70/20/10).
// Non riordina: le note arrivano già cronologiche dal
// repository, il filtro conserva l'ordine.

import type { Note, NoteTag } from './types';

/** `null` = "Tutte" (nessun filtro attivo). */
export type NoteFilter = NoteTag | null;

export function filterNotesByTag(notes: readonly Note[], filter: NoteFilter): Note[] {
  if (filter === null) return [...notes];
  return notes.filter((note) => note.tag === filter);
}
