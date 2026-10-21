// Dev-only debug trace of a refinement, returned to the app (never logged on
// the server) so a manual test can be judged afterwards: was the REQUEST
// right (the context sent), was the MODEL's ANSWER right (raw suggestions), and
// what did the server keep or drop, and why.
//
// Off by default. On only when the deployment sets DEBUG_TRACE=1 (a dev
// project) or runs in the emulator, AND the app asks for it (`debug: true`,
// sent only by dev builds). The trace may carry chapter text: it goes back to
// the same user who sent that text and is never written to Firestore or logs.

import type { HistoryCheckResult } from './history/historyCheck';
import { densityCap, type DropReason, type NormalizedSuggestions } from './normalizeSuggestions';
import type { ModelOutput } from './refineTypes';
import { resolveStyleId } from './styles';

/** Longest chapter text excerpt carried by the trace. */
export const TRACE_SNIPPET_CHARS = 300;

type Env = Record<string, string | undefined>;

/** Whether this deployment may return debug traces at all. */
export function debugTraceEnabled(env: Env): boolean {
  return env.DEBUG_TRACE === '1' || env.FUNCTIONS_EMULATOR === 'true';
}

type ModelSuggestion = ModelOutput['suggestions'][number];

/** Why a suggestion was dropped: normalization codes plus the history merge ones. */
export type TraceDropReason =
  DropReason | 'overlaps-history-check' | 'history-from-main-call' | 'overlaps-grammar';

export interface TraceSuggestion {
  kind: ModelSuggestion['kind'];
  aspect?: string;
  original: string;
  proposals: string[];
  rationale: string;
}

export interface RefineDebugTrace {
  promptVersion: number;
  model: string;
  context: {
    style: string;
    language: string;
    genre: string;
    /** Period found by the history check, or null. */
    period: string | null;
    synopsisChars: number;
    outlineBeats: number;
    chapterTitle: string;
    textChars: number;
    textWords: number;
    textHash: string;
    textSnippet: string;
    densityCap: number;
  };
  /** Suggestions of the refinement call, as the model returned them. */
  raw: TraceSuggestion[];
  /** Items of the refinement reply that failed the schema (count only). */
  parseDropped: number;
  history: {
    raw: TraceSuggestion[];
    calls: number;
    dropped: number;
    error: string | null;
  } | null;
  /** What the app receives. */
  normalized: TraceSuggestion[];
  dropped: (TraceSuggestion & { reason: TraceDropReason })[];
}

const toTrace = (sug: {
  kind: ModelSuggestion['kind'];
  aspect?: string;
  original: string;
  proposals: string[];
  rationale: string;
}): TraceSuggestion => ({
  kind: sug.kind,
  ...(sug.aspect !== undefined ? { aspect: sug.aspect } : {}),
  original: sug.original,
  proposals: sug.proposals,
  rationale: sug.rationale,
});

export function buildRefineDebugTrace(args: {
  promptVersion: number;
  model: string;
  book: { genre: string; language: string; synopsis: string; styleProfileId: string | null };
  chapter: { title: string; outline: { summary: string; beats: string[] } | null };
  text: string;
  textHash: string;
  raw: ModelSuggestion[];
  parseDropped: number;
  history: HistoryCheckResult | null;
  merged: ModelSuggestion[];
  normalized: NormalizedSuggestions;
}): RefineDebugTrace {
  const { book, chapter, text, history, merged, normalized } = args;
  const words = text.match(/\S+/g)?.length ?? 0;
  const inMerge = new Set(merged);

  const mergeLosses: RefineDebugTrace['dropped'] = [
    ...args.raw
      .filter((sug) => !inMerge.has(sug))
      .map((sug) => ({
        ...toTrace(sug),
        reason: (sug.kind === 'history'
          ? 'history-from-main-call'
          : 'overlaps-history-check') as TraceDropReason,
      })),
    ...(history?.suggestions ?? [])
      .filter((sug) => !inMerge.has(sug))
      .map((sug) => ({ ...toTrace(sug), reason: 'overlaps-grammar' as TraceDropReason })),
  ];
  // the normalizer keeps no rationale: recover it from the merged suggestion
  const rationaleOf = (original: string) =>
    merged.find((sug) => sug.original === original || sug.original.trim() === original)
      ?.rationale ?? '';

  return {
    promptVersion: args.promptVersion,
    model: args.model,
    context: {
      style: resolveStyleId(book.styleProfileId),
      language: book.language,
      genre: book.genre,
      period: history?.periodLabel ?? null,
      synopsisChars: book.synopsis.length,
      outlineBeats: chapter.outline?.beats.length ?? 0,
      chapterTitle: chapter.title,
      textChars: text.length,
      textWords: words,
      textHash: args.textHash,
      textSnippet: text.slice(0, TRACE_SNIPPET_CHARS),
      densityCap: densityCap(words),
    },
    raw: args.raw.map(toTrace),
    parseDropped: args.parseDropped,
    history:
      history === null
        ? null
        : {
            raw: history.suggestions.map(toTrace),
            calls: history.calls,
            dropped: history.dropped,
            error: history.error?.kind ?? null,
          },
    normalized: normalized.suggestions.map(toTrace),
    dropped: [
      ...mergeLosses,
      ...normalized.droppedItems.map((d) => ({
        kind: d.kind,
        original: d.original,
        proposals: d.proposals,
        rationale: rationaleOf(d.original),
        reason: d.reason,
      })),
    ],
  };
}
