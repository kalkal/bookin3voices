// BackupService on the `exportBackup` callable (functions): the only point
// of the Settings feature that talks to the Cloud Functions. The response
// goes through Zod at the boundary: never trust data coming from
// outside. Same schema as CallableBookExportService.

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
  /** Injectable in tests in place of httpsCallable. */
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
