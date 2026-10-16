// Decodifica dei documenti capitolo al confine (Zod + upgrade-on-read).
// Funzioni pure: i test non hanno bisogno né dell'SDK né dell'emulatore.

import { chapterDocSchema } from './types';
import type { Chapter, ChapterDoc, ChapterSummary } from './types';

/**
 * Upgrade-on-read: ogni documento porta la propria schemaVersion e
 * i documenti vecchi si aggiornano pigramente alla prima lettura. Oggi esiste
 * solo la v1, quindi il passaggio è l'identità; quando lo schema evolverà, qui
 * si aggiungerà la migrazione `v1 → v2` (e il repository riscriverà il
 * documento aggiornato).
 */
export function upgradeChapterData(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

/**
 * Valida (e aggiorna, se serve) i dati grezzi di un documento capitolo.
 * Ritorna null su payload non conformi: sta al chiamante decidere se saltare
 * la riga (liste) o considerarlo un errore (letture puntuali).
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
