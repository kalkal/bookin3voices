// Contratto dell'export: input della callable validato con
// Zod al confine, documenti Firestore validati alla lettura (parse, don't
// validate) e interfaccia Strategy `Exporter` con una implementazione per
// formato, registrate nella factory (exporterFactory.ts).

import { z } from 'zod';

import type { PreflightReport } from './kdpPreflight';

export const EXPORT_FORMATS = ['epub', 'docx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * Input della callable `exportBook`. Il requestId è la chiave di idempotenza
 * e diventa l'id del documento `users/{uid}/exports/{requestId}`:
 * per questo il formato è ristretto ai caratteri sicuri per un id Firestore.
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
 * Campi del documento libro che servono all'export (metadati KDP).
 * Subset dello schema: il resto del documento non riguarda l'export.
 */
export const bookExportDocSchema = z.object({
  title: z.string(),
  author: z.string(),
  description: z.string(),
  /** Lingua del libro ('it'): se vuota si esporta comunque, con default 'it'. */
  language: z.string(),
  genre: z.string(),
});

/**
 * Campi del documento capitolo che servono all'export. I suggerimenti pending
 * vivono in una sottocollezione e NON vengono letti: l'export usa solo il
 * `rawText` finale.
 */
export const chapterExportDocSchema = z.object({
  order: z.number(),
  title: z.string(),
  rawText: z.string(),
});

/** Libro composto e pronto per il rendering: capitoli già in ordine. */
export interface BookForExport {
  title: string;
  author: string;
  description: string;
  language: string;
  genre: string;
  chapters: { title: string; rawText: string }[];
}

/**
 * Strategy `Exporter`: `render(book) → Buffer`. `generatedAt` è la
 * data di creazione dell'export (fissata dal registro di idempotenza, così un
 * retry produce gli stessi metadati).
 */
export interface Exporter {
  readonly format: ExportFormat;
  readonly mimeType: string;
  readonly extension: string;
  render(book: BookForExport, generatedAt: Date): Promise<Buffer>;
}

/**
 * Registro dell'export su `users/{uid}/exports/{requestId}`.
 * `storagePath` resta null nell'MVP: Storage non è attivo (piano Spark), il
 * file torna al client nella risposta; la variante Storage+URL firmato è
 * annotata come lavoro futuro.
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

/** Risposta della callable: il file torna al client come base64 (MVP). */
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
