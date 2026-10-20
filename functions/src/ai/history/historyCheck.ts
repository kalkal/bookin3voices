// History check: two short model calls next to the refinement, turned into
// `history` suggestions by code. The code, not the model, guarantees the
// contract: a period counts only if its quote is really in the text; every
// item needs an exact quote, a category from the closed list and (for
// anachronisms) a known severity; at most 2 period details and 3
// anachronisms; every rationale starts with "Da verificare:" / "To check:".
// Failures are values: a failed call means no history suggestions, never a
// failed refinement.

import { z } from 'zod';

import type { AiError, AiProvider } from '../provider/types';
import { modelSuggestionSchema, type ModelOutput } from '../refineTypes';
import {
  ANACHRONISM_SEVERITIES,
  HISTORY_CATEGORIES,
  buildDetectPeriodPrompt,
  buildReportHistoryPrompt,
} from './historyPrompt';

type ModelSuggestion = ModelOutput['suggestions'][number];

export const MAX_PERIOD_DETAILS = 2;
export const MAX_ANACHRONISMS = 3;
const DETECT_MAX_TOKENS = 300;
const REPORT_MAX_TOKENS = 1200;

export interface HistoryCheckResult {
  /** `history` suggestions, not yet located (normalizeSuggestions does that). */
  suggestions: ModelSuggestion[];
  /** Model calls made (1 without a period, 2 with one). */
  calls: number;
  /** The period found in the text, or null. */
  periodLabel: string | null;
  /** Items from the model dropped by the checks (diagnostics). */
  dropped: number;
  /** Set when a call failed: the caller logs it and carries on without history. */
  error?: AiError;
}

const detectSchema = z.object({
  period_named: z.boolean(),
  quote: z.string(),
  period_label: z.string(),
});

const reportSchema = z.object({
  period_details: z.array(z.unknown()).catch([]),
  anachronisms: z.array(z.unknown()).catch([]),
});

const detailSchema = z.object({
  anchor_quote: z.string().min(1),
  category: z.enum(HISTORY_CATEGORIES),
  rewrite: z.string().min(1),
  note_for_author: z.string().min(1),
});

const anachronismSchema = z.object({
  trigger_quote: z.string().min(1),
  category: z.enum(HISTORY_CATEGORIES),
  severity: z.enum(ANACHRONISM_SEVERITIES),
  replacement: z.string().min(1),
  note_for_author: z.string().min(1),
});

const PREFIX_PATTERN = /^\s*(da verificare|to check)\s*:\s*/i;

function hint(note: string, language: string): string {
  const prefix = language === 'en' ? 'To check:' : 'Da verificare:';
  return `${prefix} ${note.replace(PREFIX_PATTERN, '').trim()}`;
}

const words = (sentence: string): string[] =>
  sentence
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');

/**
 * A period detail must ADD to the author's sentence: every word of the anchor
 * appears in the rewrite, in order. A rewrite that swaps words (microwave →
 * oven) is an anachronism fix in disguise, not a detail.
 */
export function onlyAdds(anchor: string, rewrite: string): boolean {
  const target = words(rewrite);
  let index = 0;
  for (const word of words(anchor)) {
    index = target.indexOf(word, index);
    if (index === -1) return false;
    index += 1;
  }
  return true;
}

const sameWords = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((word, index) => word === b[index]);

/**
 * True when the replacement repeats the words right before or after the quote
 * («una banconota da» + «una banconota da cinquanta lire»): accepted, it would
 * leave them twice in the sentence.
 */
export function repeatsSurroundings(text: string, quote: string, replacement: string): boolean {
  const at = text.indexOf(quote);
  if (at === -1) return false;
  const before = words(text.slice(0, at));
  const after = words(text.slice(at + quote.length));
  const proposed = words(replacement);
  for (let k = 1; k <= Math.min(3, proposed.length - 1); k += 1) {
    if (before.length >= k && sameWords(before.slice(-k), proposed.slice(0, k))) return true;
    if (after.length >= k && sameWords(after.slice(0, k), proposed.slice(-k))) return true;
  }
  return false;
}

function invalidReply(): AiError {
  return {
    kind: 'invalid_json',
    retryable: false,
    message: 'history reply does not match the schema',
  };
}

export async function runHistoryCheck(args: {
  provider: AiProvider;
  text: string;
  language: string;
}): Promise<HistoryCheckResult> {
  const { provider, text, language } = args;

  const detected = await provider.generateJson({
    ...buildDetectPeriodPrompt(text),
    temperature: 0,
    maxOutputTokens: DETECT_MAX_TOKENS,
  });
  if (!detected.ok)
    return { suggestions: [], calls: 1, periodLabel: null, dropped: 0, error: detected.error };
  const period = detectSchema.safeParse(detected.value);
  if (!period.success) {
    return { suggestions: [], calls: 1, periodLabel: null, dropped: 0, error: invalidReply() };
  }
  const quote = period.data.quote.trim();
  // the code checks the evidence: a period the text does not name does not exist
  if (!period.data.period_named || quote === '' || !text.includes(quote)) {
    return { suggestions: [], calls: 1, periodLabel: null, dropped: 0 };
  }
  const periodLabel = period.data.period_label.trim() || quote;

  const reported = await provider.generateJson({
    ...buildReportHistoryPrompt({ text, periodLabel, quote, language }),
    temperature: 0,
    maxOutputTokens: REPORT_MAX_TOKENS,
  });
  if (!reported.ok)
    return { suggestions: [], calls: 2, periodLabel, dropped: 0, error: reported.error };
  const report = reportSchema.safeParse(reported.value);
  if (!report.success) {
    return { suggestions: [], calls: 2, periodLabel, dropped: 0, error: invalidReply() };
  }

  const suggestions: ModelSuggestion[] = [];
  let dropped = 0;
  const keep = (candidate: ModelSuggestion, original: string): boolean => {
    const valid = modelSuggestionSchema.safeParse(candidate);
    const usable =
      valid.success &&
      text.includes(original) &&
      candidate.proposals.every((proposal) => proposal.trim() !== original.trim());
    if (usable) suggestions.push(valid.data);
    else dropped += 1;
    return usable;
  };

  let anachronisms = 0;
  for (const raw of report.data.anachronisms) {
    const item = anachronismSchema.safeParse(raw);
    if (
      !item.success ||
      anachronisms >= MAX_ANACHRONISMS ||
      repeatsSurroundings(text, item.data.trigger_quote.trim(), item.data.replacement)
    ) {
      dropped += 1;
      continue;
    }
    const original = item.data.trigger_quote.trim();
    const kept = keep(
      {
        original,
        kind: 'history',
        aspect: 'anachronism',
        rationale: hint(item.data.note_for_author, language),
        proposals: [item.data.replacement.trim()],
      },
      original,
    );
    if (kept) anachronisms += 1;
  }

  const anachronismRanges = suggestions
    .map((sug) => rangeOf(text, sug.original))
    .filter((range): range is Range => range !== null);
  const anachronismTexts = suggestions.map((sug) => sug.original);

  let details = 0;
  for (const raw of report.data.period_details) {
    const item = detailSchema.safeParse(raw);
    if (
      !item.success ||
      details >= MAX_PERIOD_DETAILS ||
      !onlyAdds(item.data.anchor_quote, item.data.rewrite) ||
      // the anachronism inside the sentence wins: one span, the error first (by
      // position, and by text too, since a repeated word has no unique position)
      overlapsAny(rangeOf(text, item.data.anchor_quote.trim()), anachronismRanges) ||
      anachronismTexts.some((original) =>
        item.data.anchor_quote.toLocaleLowerCase().includes(original.toLocaleLowerCase()),
      )
    ) {
      dropped += 1;
      continue;
    }
    const original = item.data.anchor_quote.trim();
    const kept = keep(
      {
        original,
        kind: 'history',
        aspect: 'period',
        rationale: hint(item.data.note_for_author, language),
        proposals: [item.data.rewrite.trim()],
      },
      original,
    );
    if (kept) details += 1;
  }

  return { suggestions, calls: 2, periodLabel, dropped };
}

type Range = { from: number; to: number };

/** The span of `original` when it occurs exactly once; null if absent or ambiguous. */
function rangeOf(text: string, original: string): Range | null {
  const from = text.indexOf(original);
  if (from === -1 || text.indexOf(original, from + 1) !== -1) return null;
  return { from, to: from + original.length };
}

const overlapsAny = (range: Range | null, others: Range[]): boolean =>
  range !== null && others.some((o) => Math.max(o.from, range.from) < Math.min(o.to, range.to));

/**
 * Joins the refinement's suggestions with the history ones, one span per place:
 * an anachronism wins over any overlapping suggestion (an error in the setting);
 * a period tip loses to grammar but wins over style and pacing (a style rewrite
 * of the whole sentence would otherwise hide it). History items the main call
 * produced on its own are dropped: only the checked history path may emit them.
 * Ambiguous spans are left to normalizeSuggestions, which discards them.
 */
export function mergeWithHistory(
  main: ModelSuggestion[],
  history: ModelSuggestion[],
  text: string,
): ModelSuggestion[] {
  const rangesOf = (items: ModelSuggestion[]) =>
    items.map((sug) => rangeOf(text, sug.original)).filter((r): r is Range => r !== null);
  const anachronisms = history.filter((sug) => sug.aspect === 'anachronism');
  const grammar = main.filter((sug) => sug.kind === 'grammar');
  const anachronismRanges = rangesOf(anachronisms);
  const keptGrammar = grammar.filter(
    (sug) => !overlapsAny(rangeOf(text, sug.original), anachronismRanges),
  );
  const tips = history
    .filter((sug) => sug.aspect !== 'anachronism')
    .filter((sug) => !overlapsAny(rangeOf(text, sug.original), rangesOf(keptGrammar)));
  const historyRanges = rangesOf([...anachronisms, ...tips]);
  const others = main.filter(
    (sug) =>
      sug.kind !== 'grammar' &&
      sug.kind !== 'history' &&
      !overlapsAny(rangeOf(text, sug.original), historyRanges),
  );
  return [...keptGrammar, ...others, ...anachronisms, ...tips];
}

/**
 * Own deadline for the history check, well under the refinement's: two calls at
 * the provider's 80 s each would otherwise hold back a finished refinement.
 */
export const HISTORY_DEADLINE_MS = 25_000;

/** runHistoryCheck with a deadline: past it, no history and a timeout error. */
export async function runHistoryCheckWithin(
  args: Parameters<typeof runHistoryCheck>[0],
  deadlineMs: number = HISTORY_DEADLINE_MS,
): Promise<HistoryCheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<HistoryCheckResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          suggestions: [],
          calls: 0,
          periodLabel: null,
          dropped: 0,
          error: { kind: 'timeout', retryable: false, message: 'history check past its deadline' },
        }),
      deadlineMs,
    );
  });
  try {
    return await Promise.race([runHistoryCheck(args), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
