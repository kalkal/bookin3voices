// AI suggestion domain (`suggestions` subcollection; the proposal
// hierarchy). These types are the CONTRACT shared with the
// `refineChapter` function: the Zod schemas validate at the boundary both
// the provider output (a fake today, the callable tomorrow) and the documents
// read from disk/Firestore. If the refineChapter callable touches this schema, update it HERE
// and re-export it, never duplicate it on the functions side.

import { z } from 'zod';

import { t } from '../../i18n';

/**
 * Suggestion categories: style, grammar/slips, pacing, and history (only when
 * the text names a recognisable past period).
 */
export const SUGGESTION_KINDS = ['style', 'grammar', 'pacing', 'history'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/**
 * The two parts of a history suggestion, always hints to check, never facts:
 * `period` = a detail of the time that brings the scene to life (objects,
 * habits, sounds, places, sayings); `anachronism` = something that did not
 * exist yet, or was not in use, at that time.
 */
export const HISTORY_ASPECTS = ['period', 'anachronism'] as const;
export type HistoryAspect = (typeof HISTORY_ASPECTS)[number];

/**
 * Lifecycle states (coexistence rule):
 * `stale` = the span no longer matches the text (manual edit, text changed
 * during refinement, concurrent patch): not applicable, never blindly.
 */
export const SUGGESTION_STATES = ['pending', 'accepted', 'rejected', 'stale'] as const;
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

/** Character range [from, to) over `rawText`. Never empty. */
export const spanSchema = z
  .object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  })
  .refine((span) => span.to > span.from, { message: 'empty or reversed span' });

export type Span = z.infer<typeof spanSchema>;

/**
 * Suggestion as in the Firestore document, plus `textHash`:
 * the hash of the `rawText` the suggestion was born on; if the text changed
 * on return, the suggestion is born `stale`.
 * Proposal hierarchy: grammar ONE proposal,
 * style, pacing AND history up to 3 variants, as per the Style Bible.
 * `aspect` is present on history suggestions, and only on them.
 */
export const suggestionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(SUGGESTION_KINDS),
    /** history only: period tip or anachronism warning. */
    aspect: z.enum(HISTORY_ASPECTS).optional(),
    span: spanSchema,
    /** Current text at the span: the patch verifies it matches before applying. */
    original: z.string().min(1),
    /** 1-3 alternatives; the chosen index ends up in `acceptedProposal`. */
    proposals: z.array(z.string().min(1)).min(1).max(3),
    /** One-line rationale. */
    rationale: z.string().min(1),
    state: z.enum(SUGGESTION_STATES),
    acceptedProposal: z.number().int().min(0).optional(),
    /** Hash of the reference rawText (same algorithm as textHash.ts). */
    textHash: z.string().min(1),
  })
  .superRefine((sug, ctx) => {
    if (sug.kind === 'grammar' && sug.proposals.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'grammar: a single proposal (hierarchy)',
        path: ['proposals'],
      });
    }
    if ((sug.kind === 'history') !== (sug.aspect !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'aspect: required on history, absent on the other kinds',
        path: ['aspect'],
      });
    }
    if (sug.acceptedProposal !== undefined && sug.acceptedProposal >= sug.proposals.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'acceptedProposal outside the proposals',
        path: ['acceptedProposal'],
      });
    }
    if (sug.original.length !== sug.span.to - sug.span.from) {
      ctx.addIssue({
        code: 'custom',
        message: 'original not as long as the span',
        path: ['original'],
      });
    }
  });

export type Suggestion = z.infer<typeof suggestionSchema>;

/** Refinement request: what the refineChapter callable will receive from the client. */
export interface RefineRequest {
  bookId: string;
  chapterId: string;
  text: string;
  /** Hash of `text`: comes back in the suggestions. */
  textHash: string;
  /** Idempotency on the Functions side: a retry does not generate duplicate suggestions. */
  requestId: string;
  /** Keys of the rejected (original, proposal) pairs (rejections.ts): never proposed again. */
  rejected?: string[];
  /** Dev builds with the test log: ask for the server's debug trace. */
  debug?: boolean;
  /** «Rifinisci la selezione»: refine only [from, to) of `text`; absent = whole chapter. */
  range?: Span;
}

/** Refinement response, validated at the boundary with Zod. */
export const refineResultSchema = z.object({
  /** Hash of the text the suggestions were computed on. */
  textHash: z.string().min(1),
  suggestions: z.array(suggestionSchema),
  /** Why the list is empty (server code); unknown codes read as «nothing to fix». */
  emptyReason: z
    .enum(['nothing-to-fix', 'unsafe-dropped', 'already-rejected', 'nothing-usable'])
    .optional()
    .catch(undefined),
});

export type EmptyReason = NonNullable<z.infer<typeof refineResultSchema>['emptyReason']>;

export type RefineResult = z.infer<typeof refineResultSchema>;

/**
 * Strategy for where suggestions come from: today the fake
 * FakeSuggestionsProvider, later the `refineChapter` callable. The UI talks
 * only to this interface.
 */
export interface SuggestionsProvider {
  refine(request: RefineRequest): Promise<RefineResult>;
}

/** Category labels in the current UI language, shared by editor and review (read at render time). */
export const KIND_LABELS: Record<SuggestionKind, string> = {
  get style() {
    return t('review.kind.style');
  },
  get grammar() {
    return t('review.kind.grammar');
  },
  get pacing() {
    return t('review.kind.pacing');
  },
  get history() {
    return t('review.kind.history');
  },
};

/** Labels of the two history aspects in the current UI language (read at render time). */
export const HISTORY_ASPECT_LABELS: Record<HistoryAspect, string> = {
  get period() {
    return t('review.history.period');
  },
  get anachronism() {
    return t('review.history.anachronism');
  },
};
