// BookExportService on the `exportBook` callable (functions): the only point
// of the app that talks to the Cloud Functions for export. The response goes
// through Zod at the boundary: never trust data coming from outside.

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
  /** Injectable in tests in place of httpsCallable. */
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
