// Contratti della scaletta capitoli (Fase 2): la risposta
// della callable passa da Zod al confine e il servizio è
// un'interfaccia — la UI non importa mai l'SDK Firebase (Repository/Strategy).

import { z } from 'zod';

/**
 * Una scheda della scaletta proposta (anteprima corkboard): titolo,
 * riassunto e beat. È la forma con cui la proposta vive nella UI, modificabile
 * ed eliminabile PRIMA della conferma; alla conferma diventa un capitolo
 * `status: draft` con campo `outline` (merge additivo).
 */
export const outlineCardSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  beats: z.array(z.string().trim().min(1)).min(1),
});

export type OutlineCard = z.infer<typeof outlineCardSchema>;

/** Risposta della callable generateOutline, validata al confine. */
export const outlineProposalSchema = z.object({
  requestId: z.string(),
  bookId: z.string(),
  model: z.string(),
  promptVersion: z.number(),
  createdAt: z.number(),
  chapters: z.array(outlineCardSchema).min(1),
});

export type OutlineProposal = z.infer<typeof outlineProposalSchema>;

/** Input della callable: il requestId è la chiave di idempotenza. */
export interface GenerateOutlineRequest {
  bookId: string;
  synopsis: string;
  requestId: string;
}

/** Il servizio che genera la scaletta (callable in produzione, fake nei test/E2E). */
export interface OutlineService {
  generateOutline(request: GenerateOutlineRequest): Promise<OutlineProposal>;
}
