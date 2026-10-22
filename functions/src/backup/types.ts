// Contract of the Markdown backup (exit route independent of Firebase and of the AI provider).
// Callable input validated with Zod at the boundary, Firestore documents
// validated on read (parse, don't validate), response as a base64 zip - same
// MVP-without-Storage approach as the Export feature.

import { z } from 'zod';

import { docIdSchema } from '../docId';

/**
 * Input of the `exportBackup` callable. Without `bookId`, ALL books are
 * exported (the main use case of this callable: take everything home). The
 * requestId is the idempotency key and becomes the id of the document
 * `users/{uid}/exports/{requestId}`: characters safe for a Firestore id.
 */
export const exportBackupInputSchema = z.object({
  bookId: docIdSchema.optional(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

export type ExportBackupInput = z.infer<typeof exportBackupInputSchema>;

/**
 * Book document fields needed by the backup: the metadata ends up in the book
 * index (indice.md). Subset of the schema.
 */
export const bookBackupDocSchema = z.object({
  title: z.string(),
  author: z.string(),
  description: z.string(),
  language: z.string(),
  genre: z.string(),
});

/**
 * Chapter document fields needed by the backup: the frontmatter wants
 * title/order/status/wordCount, the body is the FAITHFUL rawText (the backup is
 * raw text, never reworked). Pending suggestions live in a subcollection and
 * are NOT read (as in export).
 */
export const chapterBackupDocSchema = z.object({
  order: z.number(),
  title: z.string(),
  status: z.string(),
  wordCount: z.number(),
  rawText: z.string(),
});

export type ChapterForBackup = z.infer<typeof chapterBackupDocSchema>;

/** Book ready for backup: chapters already in reading order. */
export interface BookForBackup {
  title: string;
  author: string;
  description: string;
  language: string;
  genre: string;
  chapters: ChapterForBackup[];
}

/**
 * Backup registry entry at `users/{uid}/exports/{requestId}`: same collection
 * as exports, distinguished by `format: 'backup-md'`. `bookId` null = backup of
 * all books. `storagePath` stays null in the MVP (Spark plan).
 */
export const backupRegistryDocSchema = z.object({
  schemaVersion: z.literal(1),
  format: z.literal('backup-md'),
  bookId: z.string().nullable(),
  storagePath: z.null(),
  createdAt: z.number(),
  fileName: z.string().optional(),
  size: z.number().optional(),
});

export type BackupRegistryDoc = z.infer<typeof backupRegistryDocSchema>;

/** Callable response: the zip is returned to the client as base64 (MVP). */
export interface ExportBackupResponse {
  exportId: string;
  fileName: string;
  mimeType: string;
  base64: string;
  size: number;
  createdAt: number;
  /** How many books ended up in the zip (for the in-app message). */
  bookCount: number;
}
