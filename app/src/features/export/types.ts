// Contracts of the Export feature: the UI talks
// only to these interfaces (Repository/Strategy), never to the Firebase SDK
// or to native sharing modules. The response contract is
// SHARED with the `exportBook` callable (functions/src/export/types.ts): if
// one of the two sides changes, the other must be updated too.

import { z } from 'zod';

export const EXPORT_FORMATS = ['epub', 'docx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  epub: 'EPUB',
  docx: 'DOCX',
};

/** Response of the callable, validated with Zod at the boundary. */
export const exportFileSchema = z.object({
  exportId: z.string().min(1),
  format: z.enum(EXPORT_FORMATS),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  /** MVP without Storage (Spark plan): the file arrives as base64. */
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
  /** Idempotency key: a retry does not generate duplicate exports. */
  requestId: string;
  /** When true the server refuses to export if the KDP preflight finds errors. */
  strict?: boolean;
}

/** Generates the file (today: `exportBook` callable on the Cloud Functions). */
export interface BookExportService {
  exportBook(request: ExportRequest): Promise<ExportFile>;
}

/**
 * Count of the book's pending suggestions: before
 * exporting, the user must be warned that the export ignores them.
 */
export interface PendingSuggestionsRepository {
  countPending(bookId: string): Promise<number>;
}

/**
 * The minimum needed to save and share a file that arrived as base64:
 * satisfied by both the Export feature's ExportFile and the Backup feature's backup zip.
 */
export interface ShareableFile {
  fileName: string;
  mimeType: string;
  base64: string;
}

/** Saves the file locally and opens the share sheet. */
export interface ExportFileSink {
  saveAndShare(file: ShareableFile): Promise<void>;
}
