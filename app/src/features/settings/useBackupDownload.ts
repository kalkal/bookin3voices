// "Scarica backup ora" flow: calls the callable, saves locally
// and opens the share sheet, with progress state always visible (never mute
// spinners, as in the Export tab of the Export feature). The screen stays rendering-only.

import { useCallback, useState } from 'react';

import { t, tn } from '../../i18n';
import { makeRequestId } from '../export';
import type { ExportFileSink } from '../export';
import type { BackupService } from './backup';

export type BackupProgress =
  | { phase: 'idle' }
  | { phase: 'working'; message: string }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return t('settings.backup.error');
}

export interface BackupDownload {
  progress: BackupProgress;
  working: boolean;
  /** Starts the backup of all books; errors end up in `progress`. */
  download: () => void;
}

export function useBackupDownload(
  service: BackupService,
  fileSink: ExportFileSink,
  /** Called on a successful backup, with the file's createdAt (reminder). */
  onSuccess: (createdAt: number) => void,
): BackupDownload {
  const [progress, setProgress] = useState<BackupProgress>({ phase: 'idle' });

  const download = useCallback(() => {
    setProgress({ phase: 'working', message: t('settings.backup.working') });
    void (async () => {
      try {
        const file = await service.exportBackup({ requestId: makeRequestId() });
        setProgress({ phase: 'working', message: t('settings.backup.zipReady') });
        await fileSink.saveAndShare(file);
        onSuccess(file.createdAt);
        const books = tn('settings.backup.books', file.bookCount);
        setProgress({
          phase: 'done',
          message: t('settings.backup.done', {
            fileName: file.fileName,
            books,
            size: Math.max(1, Math.round(file.size / 1024)),
          }),
        });
      } catch (error) {
        setProgress({ phase: 'error', message: errorMessage(error) });
      }
    })();
  }, [service, fileSink, onSuccess]);

  return { progress, working: progress.phase === 'working', download };
}
