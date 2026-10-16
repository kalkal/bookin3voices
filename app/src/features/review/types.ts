// Dominio dei suggerimenti AI (sottocollezione `suggestions`; per
// la gerarchia delle proposte). Questi tipi sono il CONTRATTO condiviso con la
// function `refineChapter`: gli schemi Zod validano al confine sia
// l'output del provider (oggi finto, domani la callable) sia i documenti letti
// da disco/Firestore. Se la callable refineChapter tocca questo schema, va aggiornato QUI e
// riesportato, mai duplicato lato functions.

import { z } from 'zod';

/** Categorie dei suggerimenti: stile, grammatica/refusi, ritmo. */
export const SUGGESTION_KINDS = ['style', 'grammar', 'pacing'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/**
 * Stati del ciclo di vita (regola di convivenza):
 * `stale` = lo span non combacia più col testo (edit manuale, testo cambiato
 * durante la rifinitura, patch concorrente): non applicabile, mai in cieco.
 */
export const SUGGESTION_STATES = ['pending', 'accepted', 'rejected', 'stale'] as const;
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

/** Intervallo di caratteri [from, to) su `rawText`. Mai vuoto. */
export const spanSchema = z
  .object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  })
  .refine((span) => span.to > span.from, { message: 'span vuoto o rovesciato' });

export type Span = z.infer<typeof spanSchema>;

/**
 * Suggerimento come nel documento Firestore , più `textHash`
 * (regola): l'hash del `rawText` su cui il suggerimento è nato — se al
 * ritorno il testo è cambiato, il suggerimento nasce `stale`.
 * Gerarchia delle proposte: grammatica UNA proposta,
 * stile E ritmo fino a 3 varianti — come da Style Bible.
 */
export const suggestionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(SUGGESTION_KINDS),
    span: spanSchema,
    /** Testo attuale allo span: la patch verifica che combaci prima di applicarsi. */
    original: z.string().min(1),
    /** 1–3 alternative; l'indice scelto finisce in `acceptedProposal`. */
    proposals: z.array(z.string().min(1)).min(1).max(3),
    /** Motivazione in una riga. */
    rationale: z.string().min(1),
    state: z.enum(SUGGESTION_STATES),
    acceptedProposal: z.number().int().min(0).optional(),
    /** Hash del rawText di riferimento (stesso algoritmo di textHash.ts). */
    textHash: z.string().min(1),
  })
  .superRefine((sug, ctx) => {
    if (sug.kind === 'grammar' && sug.proposals.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'grammar: una sola proposta (gerarchia)',
        path: ['proposals'],
      });
    }
    if (sug.acceptedProposal !== undefined && sug.acceptedProposal >= sug.proposals.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'acceptedProposal fuori dalle proposte',
        path: ['acceptedProposal'],
      });
    }
    if (sug.original.length !== sug.span.to - sug.span.from) {
      ctx.addIssue({
        code: 'custom',
        message: 'original non lungo quanto lo span',
        path: ['original'],
      });
    }
  });

export type Suggestion = z.infer<typeof suggestionSchema>;

/** Richiesta di rifinitura: ciò che la callable refineChapter riceverà dal client. */
export interface RefineRequest {
  bookId: string;
  chapterId: string;
  text: string;
  /** Hash di `text` (regola): torna indietro nei suggerimenti. */
  textHash: string;
  /** Idempotenza lato Functions: un retry non genera doppi suggerimenti. */
  requestId: string;
}

/** Risposta della rifinitura, validata al confine con Zod. */
export const refineResultSchema = z.object({
  /** Hash del testo su cui i suggerimenti sono stati calcolati. */
  textHash: z.string().min(1),
  suggestions: z.array(suggestionSchema),
});

export type RefineResult = z.infer<typeof refineResultSchema>;

/**
 * Strategia di provenienza dei suggerimenti (Strategy): oggi il finto
 * FakeSuggestionsProvider, con la callable `refineChapter`. La UI parla
 * solo con questa interfaccia.
 */
export interface SuggestionsProvider {
  refine(request: RefineRequest): Promise<RefineResult>;
}

/** Etichette italiane delle categorie, condivise da editor e review. */
export const KIND_LABELS: Record<SuggestionKind, string> = {
  style: 'Stile',
  grammar: 'Grammatica',
  pacing: 'Ritmo',
};
