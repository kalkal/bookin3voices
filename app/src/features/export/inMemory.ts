// Implementazioni in memoria dei contratti export: per i test di componente e
// per la modalità E2E Maestro (App.tsx), dove Firebase non esiste.

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

/** Risponde subito con un finto file minuscolo ("finto" in base64). */
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

/** Registra i file "condivisi" senza toccare disco né share sheet. */
export class InMemoryExportFileSink implements ExportFileSink {
  readonly shared: ShareableFile[] = [];

  async saveAndShare(file: ShareableFile): Promise<void> {
    this.shared.push(file);
  }
}
