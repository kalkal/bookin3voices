// Helper condivisi dai repository Firestore: conversione dei tipi SDK al
// confine. I Timestamp non escono mai dai repository — nel dominio le date
// viaggiano come millisecondi epoch (vedi bookDocSchema/chapterDocSchema).

import { Timestamp } from 'firebase/firestore';

/**
 * Copia i dati di uno snapshot convertendo ogni Timestamp di primo livello in
 * millisecondi. Gli schemi del dominio sono piatti: niente ricorsione.
 */
export function timestampsToMillis(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Timestamp) {
      out[key] = value.toMillis();
    }
  }
  return out;
}

/** Normalizza gli errori dell'SDK (che a volte lancia non-Error) in Error. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
