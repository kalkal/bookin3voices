// Contracts of the chapter outline: the callable's
// response goes through Zod at the boundary and the service is
// an interface — the UI never imports the Firebase SDK (Repository/Strategy).

import { z } from 'zod';

import type { StyleId } from '../books/styles';

/**
 * A card of the proposed outline (corkboard preview): title,
 * summary and beats. It is the shape in which the proposal lives in the UI, editable
 * and deletable BEFORE confirmation; on confirmation it becomes a chapter
 * `status: draft` with an `outline` field (additive merge).
 */
export const outlineCardSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  beats: z.array(z.string().trim().min(1)).min(1),
});

export type OutlineCard = z.infer<typeof outlineCardSchema>;

/** Response of the generateOutline callable, validated at the boundary. */
export const outlineProposalSchema = z.object({
  requestId: z.string(),
  bookId: z.string(),
  model: z.string(),
  promptVersion: z.number(),
  createdAt: z.number(),
  chapters: z.array(outlineCardSchema).min(1),
});

export type OutlineProposal = z.infer<typeof outlineProposalSchema>;

/** Input of the callable: requestId is the idempotency key. */
export interface GenerateOutlineRequest {
  bookId: string;
  synopsis: string;
  requestId: string;
  /** The book's writing style: the outline follows it (Suspense, Mystery, Storico). */
  styleId?: StyleId;
}

/** The service that generates the outline (callable in production, fake in tests/E2E). */
export interface OutlineService {
  generateOutline(request: GenerateOutlineRequest): Promise<OutlineProposal>;
}
