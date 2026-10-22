// Types and Zod schemas for refineChapter.
//
// The response CONTRACT is defined by the app in
// app/src/features/review/types.ts (refineResultSchema): the callable's
// response must validate there TOO. There is no package shared between app/
// and functions/, so the server copy lives here (stricter: it is the truth for
// the documents written to Firestore); whoever touches one of the two files
// updates the other in the same change.
//
// Proposal hierarchy:
// grammar = exactly 1 proposal; style, pacing and history = up to 3 variants.
// history carries an `aspect` (period = a detail of the time, anachronism =
// something that did not exist yet), present on history and only there.

import { z } from 'zod';

import type { RefineDebugTrace } from './debugTrace';

export const SUGGESTION_KINDS = ['style', 'grammar', 'pacing', 'history'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** Kinds the main refinement call checks; history has its own check. */
export const MAIN_KINDS = ['style', 'grammar', 'pacing'] as const;
export type MainKind = (typeof MAIN_KINDS)[number];

/** The main kinds a refinement asks for (all of them when the user chose none). */
export function mainKindsOf(kinds: readonly SuggestionKind[] | undefined): MainKind[] {
  return MAIN_KINDS.filter((kind) => kinds === undefined || kinds.includes(kind));
}

export const HISTORY_ASPECTS = ['period', 'anachronism'] as const;
export type HistoryAspect = (typeof HISTORY_ASPECTS)[number];

/**
 * What we ask of the MODEL (structured output): no numeric offsets, since
 * models miscount characters, but the exact text of the span (`original`),
 * which the server locates in the chapter. An `original` that does not match
 * the text (absent or ambiguous) is discarded server-side.
 */
export const modelSuggestionSchema = z
  .object({
    original: z.string().min(1).max(2000),
    kind: z.enum(SUGGESTION_KINDS),
    /** history only; on other kinds normalizeSuggestions drops it. */
    aspect: z.enum(HISTORY_ASPECTS).optional(),
    rationale: z.string().min(1).max(500),
    proposals: z.array(z.string().max(2000)).min(1).max(3),
  })
  .refine((sug) => sug.kind !== 'history' || sug.aspect !== undefined, {
    message: 'history: aspect required',
    path: ['aspect'],
  });

export const modelOutputSchema = z.object({
  suggestions: z.array(modelSuggestionSchema).max(40),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

/**
 * Validates the model response while keeping the good suggestions: a single
 * malformed element (e.g. `proposals: []`) must not throw away the whole
 * response. Returns null only if no valid suggestion remains (so a retry is
 * worthwhile) or if the `suggestions` array is missing altogether.
 */
export function parseModelOutput(
  candidate: unknown,
): { output: ModelOutput; dropped: number } | null {
  const strict = modelOutputSchema.safeParse(candidate);
  if (strict.success) return { output: strict.data, dropped: 0 };
  const raw = (candidate as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(raw)) return null;
  const kept: ModelOutput['suggestions'] = [];
  for (const item of raw) {
    const one = modelSuggestionSchema.safeParse(item);
    if (one.success) kept.push(one.data);
  }
  if (kept.length === 0) return null;
  const output = kept.slice(0, 40);
  return { output: { suggestions: output }, dropped: raw.length - output.length };
}

/** Character span [from, to) over rawText, as in the app. */
export const spanSchema = z
  .object({ from: z.number().int().min(0), to: z.number().int().min(0) })
  .refine((span) => span.to > span.from, { message: 'empty or reversed span' });

/** Normalized suggestion: shape of the Firestore document and of the response. */
export const suggestionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(SUGGESTION_KINDS),
    aspect: z.enum(HISTORY_ASPECTS).optional(),
    span: spanSchema,
    original: z.string().min(1),
    proposals: z.array(z.string().min(1)).min(1).max(3),
    rationale: z.string().min(1),
    state: z.literal('pending'),
    textHash: z.string().min(1),
  })
  .superRefine((sug, ctx) => {
    if (sug.kind === 'grammar' && sug.proposals.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'grammar: exactly one proposal',
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
    if (sug.original.length !== sug.span.to - sug.span.from) {
      ctx.addIssue({
        code: 'custom',
        message: 'original length differs from the span length',
        path: ['original'],
      });
    }
  });

export type Suggestion = z.infer<typeof suggestionSchema>;

/** Callable input (mirrors RefineRequest in the app). */
export const refineChapterInputSchema = z.object({
  bookId: z.string().min(1),
  chapterId: z.string().min(1),
  /** Chapter text AS THE USER SEES IT: during a session the local editor is the
   *  master, so the client's text is authoritative, not the rawText on
   *  Firestore (which the debounce can leave behind). */
  text: z.string().min(1).max(500_000),
  /** Hash of `text` (same algorithm as textHash.ts): integrity check. */
  textHash: z.string().min(1),
  /** Idempotency: same requestId ⇒ same response, no duplicates. */
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  /** Keys of the (original, proposal) pairs the user rejected (rejections.ts): never proposed again. */
  rejected: z
    .array(z.string().regex(/^v1-[0-9a-f]{16}$/))
    .max(500)
    .optional(),
  /** Kinds the user wants checked (style, grammar, pacing, history); absent = all. */
  kinds: z.array(z.enum(SUGGESTION_KINDS)).min(1).max(4).optional(),
  /** «Rifinisci la selezione»: refine only [from, to) of `text`; absent = the whole chapter. */
  range: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional(),
  /** Dev builds ask for a debug trace; honoured only where the deployment allows it. */
  debug: z.boolean().optional(),
});

export type RefineChapterInput = z.infer<typeof refineChapterInputSchema>;

/** Callable response: also valid against the app's refineResultSchema. */
export interface RefineChapterResponse {
  requestId: string;
  textHash: string;
  model: string;
  promptVersion: number;
  suggestions: Suggestion[];
  /** Model suggestions discarded by the server (non-matching or ambiguous
   *  original, or empty proposals): diagnostics only, the app may ignore it. */
  discarded: number;
  /** Set when `suggestions` is empty: why (the app says it in plain words). */
  emptyReason?: 'nothing-to-fix' | 'unsafe-dropped' | 'already-rejected' | 'nothing-usable';
  /** Dev-only trace (see debugTrace.ts): absent unless enabled and asked for. */
  debugTrace?: RefineDebugTrace;
}

/** Idempotency registry document users/{uid}/refines/{requestId}. */
export const refineRegistryDocSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string().min(1),
  chapterId: z.string().min(1),
  textHash: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.number().int().min(1),
  suggestions: z.array(suggestionSchema),
  discarded: z.number().int().min(0),
  /** Additive: registry docs written before it have none. */
  emptyReason: z
    .enum(['nothing-to-fix', 'unsafe-dropped', 'already-rejected', 'nothing-usable'])
    .optional(),
  createdAt: z.number(),
});

export type RefineRegistryDoc = z.infer<typeof refineRegistryDocSchema>;

/** Subset of the book document useful as prompt context. */
export const bookForRefineSchema = z.object({
  title: z.string().catch(''),
  genre: z.string().catch(''),
  language: z.string().catch(''),
  synopsis: z.string().catch(''),
  /** The book's chosen writing style; null/unknown resolve to the default. */
  styleProfileId: z.string().nullable().catch(null),
});

/** Subset of the chapter document: title and outline. */
export const chapterForRefineSchema = z.object({
  title: z.string().catch(''),
  /** Stored text: context for refineTitle (refineChapter uses the client's text). */
  rawText: z.string().catch(''),
  outline: z
    .object({
      summary: z.string().catch(''),
      beats: z.array(z.string()).catch([]),
    })
    .nullable()
    .catch(null),
});

/**
 * Strategy for the refinement model (like OutlineModel): real implementations
 * on the providers, fakes in the integration tests.
 */
export interface RefineModel {
  readonly modelName: string;
  generate(prompt: {
    systemInstruction: string;
    userText: string;
    responseSchema: Record<string, unknown>;
  }): Promise<unknown>;
}
