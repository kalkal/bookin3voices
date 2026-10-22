// Contracts for outline generation: the callable input is validated with Zod
// at the boundary, the model output is NEVER trusted (parse, don't validate),
// and the `OutlineModel` interface follows the Strategy/AiProvider style. The
// callable is a thin orchestrator: the real model (ProviderModel) is injected
// and replaced by a fake in tests.

import { z } from 'zod';

import { docIdSchema } from '../docId';

import type { OutlinePrompt } from './outlinePrompt';
import { resolveStyleId, RETIRED_STYLE_IDS, STYLE_IDS } from './styles';

/**
 * A chapter proposed by the outline: title, summary and main beats.
 * The limits act as guardrails on the model output: an oversized outline is
 * non-conforming output, not data to save.
 */
export const outlineChapterSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  beats: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
});

export type OutlineChapter = z.infer<typeof outlineChapterSchema>;

export const outlineSchema = z.object({
  chapters: z.array(outlineChapterSchema).min(1).max(60),
});

export type Outline = z.infer<typeof outlineSchema>;

/**
 * Input of the `generateOutline` callable. The requestId is the idempotency
 * key and becomes the id of the document `users/{uid}/outlines/{requestId}`:
 * same restricted format as exportBook. The synopsis travels as a parameter
 * (it may differ from the one saved on the book while the user is still
 * editing it).
 */
export const generateOutlineInputSchema = z.object({
  bookId: docIdSchema,
  synopsis: z.string().trim().min(1).max(20_000),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  /**
   * The book's style as the app sees it; optional for older clients (the book's
   * is used). A retired id from an older app (thriller) maps to its successor.
   */
  styleId: z
    .enum([...STYLE_IDS, ...(Object.keys(RETIRED_STYLE_IDS) as [string, ...string[]])])
    .transform((id) => resolveStyleId(id))
    .optional(),
});

export type GenerateOutlineInput = z.infer<typeof generateOutlineInputSchema>;

/**
 * Fields of the book document needed by the prompt (context for the model).
 * A subset of the schema, as the export does.
 */
export const bookForOutlineSchema = z.object({
  title: z.string(),
  genre: z.string(),
  language: z.string(),
  /** Saved style; null, missing or unknown → the default style. */
  styleProfileId: z.string().nullable().optional().catch(null),
});

export type BookForOutline = z.infer<typeof bookForOutlineSchema>;

/**
 * Fields of the chapter document needed for generation: chapters with
 * non-empty `rawText` are UNTOUCHABLE and enter the prompt only as context
 * ("already written, do not propose again").
 */
export const chapterForOutlineSchema = z.object({
  order: z.number(),
  title: z.string(),
  rawText: z.string(),
});

/**
 * Idempotency registry at `users/{uid}/outlines/{requestId}`: a network retry
 * with the same requestId reuses the outline already generated (same
 * response, no second model call). The collection is written only by the
 * admin SDK: the security rules deny it to the client (fail-closed).
 */
export const outlineRegistryDocSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string(),
  model: z.string(),
  promptVersion: z.number().int().positive(),
  outline: outlineSchema,
  createdAt: z.number(),
});

export type OutlineRegistryDoc = z.infer<typeof outlineRegistryDocSchema>;

/** Callable response: the proposed outline, NEVER saved to the chapters; confirmation (and the additive merge) belong to the app. */
export interface GenerateOutlineResponse {
  requestId: string;
  bookId: string;
  model: string;
  promptVersion: number;
  createdAt: number;
  chapters: OutlineChapter[];
}

/**
 * The model that generates the outline (`AiProvider` Strategy): it receives
 * the already-built prompt and returns the model's JSON, NOT yet validated;
 * Zod validation stays with the callable, which is the boundary.
 */
export interface OutlineModel {
  readonly modelName: string;
  generate(prompt: OutlinePrompt): Promise<unknown>;
}
