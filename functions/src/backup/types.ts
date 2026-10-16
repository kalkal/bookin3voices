// Contratto del backup Markdown (via d'uscita indipendente da
// Firebase/Gemini). Input della callable validato con Zod al confine,
// documenti Firestore validati alla lettura (parse, don't validate), risposta
// come zip in base64 — stesso approccio MVP senza Storage della feature Export.

import { z } from 'zod';

/**
 * Input della callable `exportBackup`. Senza `bookId` si esportano TUTTI i
 * libri (è il caso d'uso principale di questa callable: portare a casa tutto). Il
 * requestId è la chiave di idempotenza e diventa l'id del documento
 * `users/{uid}/exports/{requestId}`: caratteri sicuri per un id Firestore.
 */
export const exportBackupInputSchema = z.object({
  bookId: z.string().min(1).optional(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

export type ExportBackupInput = z.infer<typeof exportBackupInputSchema>;

/**
 * Campi del documento libro che servono al backup: i metadati finiscono
 * nell'indice del libro (indice.md). Subset dello schema.
 */
export const bookBackupDocSchema = z.object({
  title: z.string(),
  author: z.string(),
  description: z.string(),
  language: z.string(),
  genre: z.string(),
});

/**
 * Campi del documento capitolo che servono al backup: il frontmatter vuole
 * titolo/ordine/stato/wordCount, il corpo è il rawText FEDELE (il backup è
 * testo grezzo, mai rielaborato). I suggerimenti pending vivono in una
 * sottocollezione e NON vengono letti (come nell'export).
 */
export const chapterBackupDocSchema = z.object({
  order: z.number(),
  title: z.string(),
  status: z.string(),
  wordCount: z.number(),
  rawText: z.string(),
});

export type ChapterForBackup = z.infer<typeof chapterBackupDocSchema>;

/** Libro pronto per il backup: capitoli già in ordine di lettura. */
export interface BookForBackup {
  title: string;
  author: string;
  description: string;
  language: string;
  genre: string;
  chapters: ChapterForBackup[];
}

/**
 * Registro del backup su `users/{uid}/exports/{requestId}`: stessa collezione
 * degli export, distinta da `format: 'backup-md'`. `bookId` null = backup
 * di tutti i libri. `storagePath` resta null nell'MVP (piano Spark).
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

/** Risposta della callable: lo zip torna al client come base64 (MVP). */
export interface ExportBackupResponse {
  exportId: string;
  fileName: string;
  mimeType: string;
  base64: string;
  size: number;
  createdAt: number;
  /** Quanti libri sono finiti nello zip (per il messaggio in app). */
  bookCount: number;
}
