// In-memory implementations of the export contracts: for component tests and
// for Maestro E2E mode (App.tsx), where Firebase does not exist.

import type {
  BookExportService,
  ExportFile,
  ExportFileSink,
  ExportRequest,
  PendingSuggestionsRepository,
  ShareableFile,
} from './types';

const MIME_TYPES: Record<ExportRequest['format'], string> = {
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Answers immediately with a tiny fake file ("fake" in base64). */
export class InMemoryBookExportService implements BookExportService {
  readonly requests: ExportRequest[] = [];

  async exportBook(request: ExportRequest): Promise<ExportFile> {
    this.requests.push(request);
    return {
      exportId: request.requestId,
      format: request.format,
      fileName: `libro.${request.format}`,
      mimeType: MIME_TYPES[request.format],
      base64: 'ZmludG8=',
      size: 5,
      createdAt: Date.now(),
    };
  }
}

export class InMemoryPendingSuggestionsRepository implements PendingSuggestionsRepository {
  constructor(private pending = 0) {}

  setPending(count: number): void {
    this.pending = count;
  }

  async countPending(): Promise<number> {
    return this.pending;
  }
}

/** Records the "shared" files without touching disk or the share sheet. */
export class InMemoryExportFileSink implements ExportFileSink {
  readonly shared: ShareableFile[] = [];

  async saveAndShare(file: ShareableFile): Promise<void> {
    this.shared.push(file);
  }
}
