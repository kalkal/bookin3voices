// Decodifica dei documenti libro al confine (Zod + upgrade-on-read).
// Funzioni pure: i test non hanno bisogno né dell'SDK né dell'emulatore.

import { getLanguage } from '../../i18n';

import { bookDocSchema } from './types';
import type { Book, BookDoc, CreateBookInput } from './types';

/**
 * Upgrade-on-read: oggi esiste solo la v1, il passaggio è
 * l'identità; le migrazioni future (v1 → v2, …) si aggiungono qui.
 */
export function upgradeBookData(data: Record<string, unknown>): Record<string, unknown> {
  return data;
}

/**
 * Valida (e aggiorna, se serve) i dati grezzi di un documento libro.
 * Ritorna null su payload non conformi: sta al chiamante decidere se saltare
 * la riga (liste) o considerarlo un errore (letture puntuali).
 */
export function decodeBookDoc(data: Record<string, unknown>): BookDoc | null {
  const parsed = bookDocSchema.safeParse(upgradeBookData(data));
  return parsed.success ? parsed.data : null;
}

export function toBook(id: string, doc: BookDoc): Book {
  return { ...doc, id };
}

/**
 * Documento di partenza per un libro nuovo (contatori a zero).
 * Le date le mette il repository (serverTimestamp al confine).
 */
export function newBookDoc(input: CreateBookInput, nowMillis: number): BookDoc {
  return {
    schemaVersion: 1,
    title: input.title,
    author: input.author ?? '',
    description: '',
    synopsis: '',
    genre: input.genre ?? (getLanguage() === 'it' ? 'Romanzo' : 'Novel'),
    // un libro nuovo nasce nella lingua dell'interfaccia (l'AI risponde in quella)
    language: input.language ?? getLanguage(),
    status: 'draft',
    styleProfileId: null,
    wordCount: 0,
    chapterCount: 0,
    createdAt: nowMillis,
    updatedAt: nowMillis,
  };
}
