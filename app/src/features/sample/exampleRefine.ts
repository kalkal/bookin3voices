// Example mode (judges' build): pre-recorded refine suggestions for the sample
// book, served ONLY offline or when the live AI is unavailable, and always
// labelled as such on screen (ids with EXAMPLE_SUGGESTION_ID_PREFIX, see review/example.ts).
//
// Wiring (EXPO_PUBLIC_SAMPLE_BOOK=1): with the judge claim App wraps the live
// provider in ExampleFallbackSuggestionsProvider; without it the offline
// ExampleOnlySuggestionsProvider (offlineSample.ts) never calls the server.
// Which errors mean "the AI is unavailable" is a hook: pass the shared
// isAiUnavailable(error) once it exists; until then isAiUnavailablePlaceholder
// covers the callable codes for "could not answer".

import { EXAMPLE_SUGGESTION_ID_PREFIX } from '../review/example';
import { rejectionKey } from '../review/rejections';
import { textHash } from '../review/textHash';
import type {
  RefineRequest,
  RefineResult,
  Span,
  Suggestion,
  SuggestionsProvider,
} from '../review/types';
import { sampleChapter } from './sampleBook';

export interface ExampleRefineOptions {
  /** Refine of a selection: only the examples inside [from, to). */
  range?: Span;
  /** Rejection keys (rejections.ts): those proposals are never served again. */
  rejected?: readonly string[];
}

/** Every occurrence of `needle` in `text`. */
function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    found.push(at);
  }
  return found;
}

/**
 * The pre-recorded refine result for a sample chapter, in the exact contract
 * refineResultSchema validates; undefined unless it is the sample book and at
 * least one example still matches the text. Spans are located in `text` the
 * way the server locates the model's `original`: an example whose original is
 * gone (edited, already accepted) or ambiguous is left out, so a span never
 * points at the wrong words.
 */
export function exampleRefineResult(
  bookId: string,
  chapterId: string,
  text: string,
  options: ExampleRefineOptions = {},
): RefineResult | undefined {
  const chapter = sampleChapter(bookId, chapterId);
  if (chapter === undefined) return undefined;
  const hash = textHash(text);
  const rejected = new Set(options.rejected ?? []);
  const suggestions: Suggestion[] = [];
  chapter.examples.forEach((example, index) => {
    const at = occurrences(text, example.original);
    if (at.length !== 1) return;
    const span = { from: at[0], to: at[0] + example.original.length };
    const { range } = options;
    if (range !== undefined && (span.from < range.from || span.to > range.to)) return;
    const proposals = example.proposals.filter(
      (proposal) => !rejected.has(rejectionKey(example.original, proposal)),
    );
    if (proposals.length === 0) return;
    suggestions.push({
      id: `${EXAMPLE_SUGGESTION_ID_PREFIX}${chapterId}-${index + 1}`,
      kind: example.kind,
      ...(example.aspect === undefined ? {} : { aspect: example.aspect }),
      span,
      original: example.original,
      proposals,
      rationale: example.rationale,
      state: 'pending',
      textHash: hash,
    });
  });
  if (suggestions.length === 0) return undefined;
  return { textHash: hash, suggestions: suggestions.sort((a, b) => a.span.from - b.span.from) };
}

/** Callable codes that mean the AI could not answer (placeholder for isAiUnavailable). */
const AI_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'functions/unavailable',
  'functions/deadline-exceeded',
  'functions/internal',
  'functions/unknown',
  'functions/resource-exhausted',
]);

/** Placeholder until the shared isAiUnavailable(error) is exported: swap it in App.tsx. */
export function isAiUnavailablePlaceholder(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && AI_UNAVAILABLE_CODES.has(code);
}

export interface ExampleFallbackSuggestionsProviderDeps {
  /** The live provider (the refineChapter callable). */
  inner: SuggestionsProvider;
  /** True when the error means the live AI is unavailable (the hook point). */
  isAiUnavailable: (error: unknown) => boolean;
}

/**
 * Decorator over the live provider: the live AI always goes first; only when
 * it is unavailable, and only on the sample book, the pre-recorded examples
 * stand in. Any other failure, or no example to serve, is the live error as is.
 */
export class ExampleFallbackSuggestionsProvider implements SuggestionsProvider {
  private readonly inner: SuggestionsProvider;
  private readonly isAiUnavailable: (error: unknown) => boolean;

  constructor(deps: ExampleFallbackSuggestionsProviderDeps) {
    this.inner = deps.inner;
    this.isAiUnavailable = deps.isAiUnavailable;
  }

  async refine(request: RefineRequest): Promise<RefineResult> {
    try {
      return await this.inner.refine(request);
    } catch (error) {
      if (!this.isAiUnavailable(error)) throw error;
      const example = exampleRefineResult(request.bookId, request.chapterId, request.text, {
        range: request.range,
        rejected: request.rejected,
      });
      if (example === undefined) throw error;
      console.info('refine-example-fallback', {
        requestId: request.requestId,
        chapterId: request.chapterId,
        count: example.suggestions.length,
      });
      return example;
    }
  }
}
