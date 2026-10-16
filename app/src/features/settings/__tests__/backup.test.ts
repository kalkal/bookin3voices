// Unit test of the app-side backup: visual reminder (backupStatus) and
// CallableBackupService (Zod at the boundary on the callable's response).

import { backupStatus, type BackupFile } from '../backup';
import { CallableBackupService } from '../CallableBackupService';

const DAY = 86_400_000;
const NOW = 1788688800000; // 2026-09-06T10:00Z

describe('backupStatus', () => {
  it('no backup: nudge, whatever the frequency', () => {
    expect(backupStatus(null, 'monthly', NOW)).toEqual({
      label: 'Nessun backup ancora',
      overdue: true,
    });
  });

  it('age in days: today, yesterday, N days ago', () => {
    expect(backupStatus(NOW - DAY / 2, 'weekly', NOW).label).toBe('Ultimo backup: oggi');
    expect(backupStatus(NOW - DAY, 'weekly', NOW).label).toBe('Ultimo backup: ieri');
    expect(backupStatus(NOW - 3 * DAY, 'weekly', NOW).label).toBe('Ultimo backup: 3 giorni fa');
  });

  it('the nudge follows the chosen frequency', () => {
    expect(backupStatus(NOW - 2 * DAY, 'daily', NOW).overdue).toBe(true);
    expect(backupStatus(NOW - 2 * DAY, 'weekly', NOW).overdue).toBe(false);
    expect(backupStatus(NOW - 8 * DAY, 'weekly', NOW).overdue).toBe(true);
    expect(backupStatus(NOW - 8 * DAY, 'monthly', NOW).overdue).toBe(false);
    expect(backupStatus(NOW - 31 * DAY, 'monthly', NOW).overdue).toBe(true);
  });

  it('a clock going backwards does not produce negative ages', () => {
    expect(backupStatus(NOW + DAY, 'weekly', NOW).label).toBe('Ultimo backup: oggi');
  });
});

describe('CallableBackupService', () => {
  const risposta: BackupFile = {
    exportId: 'req-1',
    fileName: 'backup-bookvoice-2026-09-06.zip',
    mimeType: 'application/zip',
    base64: 'ZmludG8=',
    size: 5,
    createdAt: NOW,
    bookCount: 2,
  };

  it('forwards the request to the callable and validates the response', async () => {
    const chiamate: unknown[] = [];
    const service = new CallableBackupService({
      call: async (data) => {
        chiamate.push(data);
        return { data: risposta };
      },
    });
    await expect(service.exportBackup({ requestId: 'req-1' })).resolves.toEqual(risposta);
    expect(chiamate).toEqual([{ requestId: 'req-1' }]);
  });

  it('malformed response: Zod error, never unvalidated data floating around', async () => {
    const service = new CallableBackupService({
      call: async () => ({ data: { ...risposta, base64: '' } }),
    });
    await expect(service.exportBackup({ requestId: 'req-1' })).rejects.toThrow();
  });
});
