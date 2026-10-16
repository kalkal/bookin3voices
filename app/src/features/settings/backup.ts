// Markdown backup: contracts and pure logic of the
// Data section of Settings. The response contract is SHARED with
// the `exportBackup` callable (functions/src/backup/types.ts): if one of the two
// sides changes, the other must be updated too.
//
// Reminder (declared choice): no expo-notifications — it is not among the
// dependencies and a local notification is not worth an extra native dependency. The
// chosen frequency drives a VISUAL NUDGE: "last backup: X days ago",
// highlighted when the age exceeds the frequency. A real server-side
// automatic backup requires the scheduler (Blaze) → noted as future work.

import { z } from 'zod';

import { t, tn } from '../../i18n';

import type { BackupFrequency } from './types';

/** Response of the callable, validated with Zod at the boundary. */
export const backupFileSchema = z.object({
  exportId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  /** MVP without Storage (Spark plan): the zip arrives as base64. */
  base64: z.string().min(1),
  size: z.number().int().positive(),
  createdAt: z.number(),
  bookCount: z.number().int().positive(),
});

export type BackupFile = z.infer<typeof backupFileSchema>;

export interface BackupRequest {
  /** Without bookId the callable exports ALL books (the Settings case). */
  bookId?: string;
  /** Idempotency key: a retry does not generate duplicate backups. */
  requestId: string;
}

/** Generates the backup zip (today: `exportBackup` callable on the Functions). */
export interface BackupService {
  exportBackup(request: BackupRequest): Promise<BackupFile>;
}

/** Fake for component tests and Maestro E2E mode (App.tsx). */
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

/** Maximum age (in days) before the nudge, per chosen frequency. */
export const BACKUP_FREQUENCY_DAYS: Record<BackupFrequency, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

const DAY_MS = 86_400_000;

export interface BackupStatus {
  /** Info row: "Nessun backup ancora" / "Ultimo backup: oggi/ieri/N giorni fa". */
  label: string;
  /** true = visual nudge: never backed up, or older than the frequency. */
  overdue: boolean;
}

/** Backup reminder state: pure and deterministic, `now` injected. */
export function backupStatus(
  lastBackupAt: number | null,
  frequency: BackupFrequency,
  now: number,
): BackupStatus {
  if (lastBackupAt === null) {
    return { label: t('settings.backup.none'), overdue: true };
  }
  const days = Math.floor(Math.max(0, now - lastBackupAt) / DAY_MS);
  const age =
    days === 0
      ? t('settings.backup.today')
      : days === 1
        ? t('settings.backup.yesterday')
        : tn('settings.backup.daysAgo', days);
  return {
    label: t('settings.backup.last', { age }),
    overdue: days > BACKUP_FREQUENCY_DAYS[frequency],
  };
}
