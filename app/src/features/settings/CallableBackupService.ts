// BackupService sulla callable `exportBackup` (functions): l'unico punto
// della feature Impostazioni che parla con le Cloud Functions. La risposta
// passa da Zod al confine: mai fidarsi dei dati che arrivano da
// fuori. Stesso schema di CallableBookExportService.

import { httpsCallable, type Functions } from 'firebase/functions';

import {
  backupFileSchema,
  type BackupFile,
  type BackupRequest,
  type BackupService,
} from './backup';

type CallBackup = (data: BackupRequest) => Promise<{ data: unknown }>;

export type CallableBackupServiceDeps =
  | { functions: Functions }
  /** Iniettabile nei test al posto di httpsCallable. */
  | { call: CallBackup };

export class CallableBackupService implements BackupService {
  private readonly call: CallBackup;

  constructor(deps: CallableBackupServiceDeps) {
    this.call =
      'call' in deps
        ? deps.call
        : httpsCallable<BackupRequest, unknown>(deps.functions, 'exportBackup');
  }

  async exportBackup(request: BackupRequest): Promise<BackupFile> {
    const result = await this.call(request);
    return backupFileSchema.parse(result.data);
  }
}
