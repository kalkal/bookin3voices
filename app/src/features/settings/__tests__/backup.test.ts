// Unit test del backup lato app: promemoria visivo (backupStatus) e
// CallableBackupService (Zod al confine sulla risposta della callable).

import { backupStatus, type BackupFile } from '../backup';
import { CallableBackupService } from '../CallableBackupService';

const DAY = 86_400_000;
const NOW = 1788688800000; // 2026-09-06T10:00Z

describe('backupStatus', () => {
  it('senza backup: sollecito, qualunque sia la frequenza', () => {
    expect(backupStatus(null, 'monthly', NOW)).toEqual({
      label: 'Nessun backup ancora',
      overdue: true,
    });
  });

  it('età in giorni: oggi, ieri, N giorni fa', () => {
    expect(backupStatus(NOW - DAY / 2, 'weekly', NOW).label).toBe('Ultimo backup: oggi');
    expect(backupStatus(NOW - DAY, 'weekly', NOW).label).toBe('Ultimo backup: ieri');
    expect(backupStatus(NOW - 3 * DAY, 'weekly', NOW).label).toBe('Ultimo backup: 3 giorni fa');
  });

  it('il sollecito segue la frequenza scelta', () => {
    expect(backupStatus(NOW - 2 * DAY, 'daily', NOW).overdue).toBe(true);
    expect(backupStatus(NOW - 2 * DAY, 'weekly', NOW).overdue).toBe(false);
    expect(backupStatus(NOW - 8 * DAY, 'weekly', NOW).overdue).toBe(true);
    expect(backupStatus(NOW - 8 * DAY, 'monthly', NOW).overdue).toBe(false);
    expect(backupStatus(NOW - 31 * DAY, 'monthly', NOW).overdue).toBe(true);
  });

  it('un orologio che va indietro non produce età negative', () => {
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

  it('inoltra la richiesta alla callable e valida la risposta', async () => {
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

  it('risposta malformata: errore Zod, mai dati non validati in giro', async () => {
    const service = new CallableBackupService({
      call: async () => ({ data: { ...risposta, base64: '' } }),
    });
    await expect(service.exportBackup({ requestId: 'req-1' })).rejects.toThrow();
  });
});
