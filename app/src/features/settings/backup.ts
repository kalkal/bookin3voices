// Backup Markdown: contratti e logica pura della
// sezione Dati delle Impostazioni. Il contratto della risposta è CONDIVISO con
// la callable `exportBackup` (functions/src/backup/types.ts): se una delle due
// parti cambia, va aggiornata anche l'altra.
//
// Promemoria (scelta dichiarata): niente expo-notifications — non è tra le
// dipendenze e una notifica locale non vale una dipendenza nativa in più. La
// frequenza scelta pilota un SOLLECITO VISIVO: "ultimo backup: X giorni fa",
// evidenziato quando l'età supera la frequenza. Il backup automatico
// server-side vero richiede lo scheduler (Blaze) → annotato come lavoro futuro.

import { z } from 'zod';

import type { BackupFrequency } from './types';

/** Risposta della callable, validata con Zod al confine. */
export const backupFileSchema = z.object({
  exportId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  /** MVP senza Storage (piano Spark): lo zip arriva in base64. */
  base64: z.string().min(1),
  size: z.number().int().positive(),
  createdAt: z.number(),
  bookCount: z.number().int().positive(),
});

export type BackupFile = z.infer<typeof backupFileSchema>;

export interface BackupRequest {
  /** Senza bookId la callable esporta TUTTI i libri (il caso delle Impostazioni). */
  bookId?: string;
  /** Chiave di idempotenza: un retry non genera doppi backup. */
  requestId: string;
}

/** Genera lo zip del backup (oggi: callable `exportBackup` sulle Functions). */
export interface BackupService {
  exportBackup(request: BackupRequest): Promise<BackupFile>;
}

/** Fake per test di componente e modalità E2E Maestro (App.tsx). */
export class InMemoryBackupService implements BackupService {
  readonly requests: BackupRequest[] = [];

  async exportBackup(request: BackupRequest): Promise<BackupFile> {
    this.requests.push(request);
    return {
      exportId: request.requestId,
      fileName: 'backup-bookvoice-2026-09-06.zip',
      mimeType: 'application/zip',
      base64: 'ZmludG8=',
      size: 5,
      createdAt: Date.now(),
      bookCount: 1,
    };
  }
}

/** Età massima (in giorni) prima del sollecito, per frequenza scelta. */
export const BACKUP_FREQUENCY_DAYS: Record<BackupFrequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

const DAY_MS = 86_400_000;

export interface BackupStatus {
  /** Riga informativa: "Nessun backup ancora" / "Ultimo backup: oggi/ieri/N giorni fa". */
  label: string;
  /** true = sollecito visivo: mai fatto un backup, o più vecchio della frequenza. */
  overdue: boolean;
}

/** Stato del promemoria backup: puro e deterministico, `now` iniettato. */
export function backupStatus(
  lastBackupAt: number | null,
  frequency: BackupFrequency,
  now: number,
): BackupStatus {
  if (lastBackupAt === null) {
    return { label: 'Nessun backup ancora', overdue: true };
  }
  const days = Math.floor(Math.max(0, now - lastBackupAt) / DAY_MS);
  const age = days === 0 ? 'oggi' : days === 1 ? 'ieri' : `${days} giorni fa`;
  return { label: `Ultimo backup: ${age}`, overdue: days > BACKUP_FREQUENCY_DAYS[frequency] };
}
