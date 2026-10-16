// Export contract: callable input validated with Zod at the boundary,
// Firestore documents validated on read (parse, don't validate) and the
// `Exporter` strategy interface with one implementation per format,
// registered in the factory (exporterFactory.ts).

import { z } from 'zod';

import type { PreflightReport } from './kdpPreflight';

export const EXPORT_FORMATS = ['epub', 'docx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Input of the `exportBook` callable. The requestId is the idempotency key and
 * becomes the id of the document `users/{uid}/exports/{requestId}`: that is why
 * its format is restricted to characters safe for a Firestore id.
 */
export const exportBookInputSchema = z.object({
  bookId: z.string().min(1),
  format: z.enum(EXPORT_FORMATS),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  /** When true, KDP preflight errors block the export (failed-precondition). */
  strict: z.boolean().optional(),
});

export type ExportBookInput = z.infer<typeof exportBookInputSchema>;

/**
 * Book document fields needed by export (KDP metadata). Subset of the schema:
 * the rest of the document is irrelevant to export.
 */
export const bookExportDocSchema = z.object({
  title: z.string(),
  author: z.string(),
  description: z.string(),
  /** Book language ('it'): if empty, export still proceeds with default 'it'. */
  language: z.string(),
  genre: z.string(),
});

/**
 * Chapter document fields needed by export. Pending suggestions live in a
 * subcollection and are NOT read: export uses only the final `rawText`.
 */
export const chapterExportDocSchema = z.object({
  order: z.number(),
  title: z.string(),
  rawText: z.string(),
});

/** Composed book ready for rendering: chapters already in order. */
export interface BookForExport {
  title: string;
  author: string;
  description: string;
  language: string;
  genre: string;
  chapters: { title: string; rawText: string }[];
}

/**
 * `Exporter` strategy: `render(book) -> Buffer`. `generatedAt` is the export
 * creation date (pinned by the idempotency registry, so a retry produces the
 * same metadata).
 */
export interface Exporter {
  readonly format: ExportFormat;
  readonly mimeType: string;
  readonly extension: string;
  render(book: BookForExport, generatedAt: Date): Promise<Buffer>;
}

/**
 * Export registry entry at `users/{uid}/exports/{requestId}`. `storagePath`
 * stays null in the MVP: Storage is not enabled (Spark plan), the file is
 * returned to the client in the response; the Storage + signed URL variant is
 * noted as future work.
 */
export const exportRegistryDocSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string(),
  format: z.enum(EXPORT_FORMATS),
  storagePath: z.null(),
  createdAt: z.number(),
  fileName: z.string().optional(),
  size: z.number().optional(),
});

export type ExportRegistryDoc = z.infer<typeof exportRegistryDocSchema>;

/** Callable response: the file is returned to the client as base64 (MVP). */
export interface ExportBookResponse {
  exportId: string;
  format: ExportFormat;
  fileName: string;
  mimeType: string;
  base64: string;
  size: number;
  createdAt: number;
  /** KDP preflight report (errors block only when `strict` was requested). */
  preflight: PreflightReport;
}
