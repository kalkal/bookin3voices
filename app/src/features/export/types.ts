// Contratti della feature Export: la UI parla
// solo con queste interfacce (Repository/Strategy), mai con l'SDK Firebase
// o con i moduli nativi di condivisione. Il contratto della risposta è
// CONDIVISO con la callable `exportBook` (functions/src/export/types.ts): se
// una delle due parti cambia, va aggiornata anche l'altra.

import { z } from 'zod';

export const EXPORT_FORMATS = ['epub', 'docx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  epub: 'EPUB',
  docx: 'DOCX',
};

/** Risposta della callable, validata con Zod al confine. */
export const exportFileSchema = z.object({
  exportId: z.string().min(1),
  format: z.enum(EXPORT_FORMATS),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  /** MVP senza Storage (piano Spark): il file arriva in base64. */
  base64: z.string().min(1),
  size: z.number().int().positive(),
  createdAt: z.number(),
  /** KDP preflight report from the callable (absent on older deployments). */
  preflight: z
    .object({
      ok: z.boolean(),
      errors: z.array(z.object({ code: z.string(), message: z.string() })),
      warnings: z.array(z.object({ code: z.string(), message: z.string() })),
    })
    .optional(),
});

export type ExportFile = z.infer<typeof exportFileSchema>;

export interface ExportRequest {
  bookId: string;
  format: ExportFormat;
  /** Chiave di idempotenza: un retry non genera doppi export. */
  requestId: string;
  /** When true the server refuses to export if the KDP preflight finds errors. */
  strict?: boolean;
}

/** Genera il file (oggi: callable `exportBook` sulle Cloud Functions). */
export interface BookExportService {
  exportBook(request: ExportRequest): Promise<ExportFile>;
}

/**
 * Conteggio dei suggerimenti pending del libro: prima
 * dell'export l'utente va avvisato che l'export li ignora.
 */
export interface PendingSuggestionsRepository {
  countPending(bookId: string): Promise<number>;
}

/**
 * Il minimo che serve per salvare e condividere un file arrivato in base64:
 * lo soddisfano sia l'ExportFile della feature Export sia lo zip del backup della feature Backup.
 */
export interface ShareableFile {
  fileName: string;
  mimeType: string;
  base64: string;
}

/** Salva il file in locale e apre lo share sheet. */
export interface ExportFileSink {
  saveAndShare(file: ShareableFile): Promise<void>;
}
