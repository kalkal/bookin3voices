// Decodifica dei documenti nota al confine (Zod + upgrade-on-read).
// Funzioni pure: i test non hanno bisogno né dell'SDK né dell'emulatore.

import { noteDocSchema } from './types';
import type { Note, NoteDoc } from './types';

/**
 * Upgrade-on-read: ogni documento porta la propria schemaVersion e
 * i documenti vecchi si aggiornano pigramente alla prima lettura. Oggi esiste
 * solo la v1, quindi il passaggio è l'identità; quando lo schema evolverà, qui
 * si aggiungerà la migrazione `v1 → v2` (e il repository riscriverà il
 * documento aggiornato).
 */
export function upgradeNoteData(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

/**
 * Valida (e aggiorna, se serve) i dati grezzi di un documento nota.
 * Ritorna null su payload non conformi: sta al chiamante decidere se saltare
 * la riga (liste) o considerarlo un errore (letture puntuali).
 */
export function decodeNoteDoc(data: Record<string, unknown>): NoteDoc | null {
  const parsed = noteDocSchema.safeParse(upgradeNoteData(data));
  return parsed.success ? parsed.data : null;
}

export function toNote(id: string, bookId: string, doc: NoteDoc): Note {
  return { ...doc, id, bookId };
}
