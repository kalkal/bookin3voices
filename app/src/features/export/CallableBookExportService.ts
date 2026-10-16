// BookExportService sulla callable `exportBook` (functions): l'unico punto
// dell'app che parla con le Cloud Functions per l'export. La risposta passa
// da Zod al confine: mai fidarsi dei dati che arrivano da fuori.

import { httpsCallable, type Functions } from 'firebase/functions';

import {
  exportFileSchema,
  type BookExportService,
  type ExportFile,
  type ExportRequest,
} from './types';

type CallExport = (data: ExportRequest) => Promise<{ data: unknown }>;

export type CallableBookExportServiceDeps =
  | { functions: Functions }
  /** Iniettabile nei test al posto di httpsCallable. */
  | { call: CallExport };

export class CallableBookExportService implements BookExportService {
  private readonly call: CallExport;

  constructor(deps: CallableBookExportServiceDeps) {
    this.call =
      'call' in deps
        ? deps.call
        : httpsCallable<ExportRequest, unknown>(deps.functions, 'exportBook');
  }

  async exportBook(request: ExportRequest): Promise<ExportFile> {
    const result = await this.call(request);
    return exportFileSchema.parse(result.data);
  }
}
