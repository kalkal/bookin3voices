// Normalization of the model output into text-anchored suggestions.
// The mechanical defenses of the contract live here:
// - an `original` that is absent from the text or appears more than once →
//   DISCARDED (never a blind application);
// - empty proposals, or ones identical to the original → removed; with no
//   proposals left → discarded;
// - grammar with several proposals → keep the first (the most conservative by
//   prompt design), per the proposal hierarchy;
// - `aspect` is kept on history only (parseModelOutput already dropped a
//   history without one);
// - Style Bible density cap, enforced here because the model does not keep it
//   (Nova golden run, 20/10: 16 suggestions on 345 words): about one every 50
//   words, at least 3, never more than 30; over the cap the best suggestion of
//   each 50-word window is kept first (so the end of the text is not starved),
//   then the rest by priority (grammar and anachronisms, then style and
//   pacing, period tips last) and in text order;
// - overlapping spans → the higher priority wins, then the first in text order
//   (the app does not handle overlapping highlights).

import type { ModelOutput, Suggestion } from './refineTypes';

export interface NormalizedSuggestions {
  suggestions: Suggestion[];
  /** How many model suggestions were discarded (diagnostics), density cut included. */
  discarded: number;
  /** How many valid suggestions the density cap removed (part of `discarded`). */
  densityCut: number;
}

export const MAX_SUGGESTIONS = 30;
const WORDS_PER_SUGGESTION = 50;
const MIN_CAP = 3;

/** How many suggestions a text of `words` words can carry (Style Bible density). */
export function densityCap(words: number): number {
  return Math.min(MAX_SUGGESTIONS, Math.max(MIN_CAP, Math.ceil(words / WORDS_PER_SUGGESTION)));
}

/** All occurrences of `needle` in `haystack` (start indices). */
function occurrencesOf(haystack: string, needle: string): number[] {
  const result: number[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    result.push(index);
    index = haystack.indexOf(needle, index + 1);
  }
  return result;
}

export function normalizeSuggestions(
  output: ModelOutput,
  text: string,
  hash: string,
  requestId: string,
): NormalizedSuggestions {
  const located: Located[] = [];
  let discarded = 0;

  for (const rawSuggestion of output.suggestions) {
    // models often add stray leading/trailing whitespace when copying a span:
    // retry with the trimmed span before giving up (still exactly-one match)
    let raw = rawSuggestion;
    let occurrences = occurrencesOf(text, raw.original);
    const trimmed = raw.original.trim();
    if (occurrences.length === 0 && trimmed !== '' && trimmed !== raw.original) {
      raw = { ...rawSuggestion, original: trimmed };
      occurrences = occurrencesOf(text, trimmed);
    }
    if (occurrences.length !== 1) {
      discarded += 1; // absent or ambiguous: never guess the span
      continue;
    }
    const from = occurrences[0] as number;

    let proposals = raw.proposals
      .map((proposal) => proposal.trim())
      .filter((proposal) => proposal !== '' && proposal !== raw.original);
    if (raw.kind === 'grammar') proposals = proposals.slice(0, 1);
    if (proposals.length === 0) {
      discarded += 1;
      continue;
    }

    located.push({
      kind: raw.kind,
      ...(raw.kind === 'history' && raw.aspect ? { aspect: raw.aspect } : {}),
      span: { from, to: from + raw.original.length },
      original: raw.original,
      proposals,
      rationale: raw.rationale,
      state: 'pending',
      textHash: hash,
    });
  }

  // overlaps: grammar wins (a real error beats a style nuance), then the first in text order
  const byPriority = [...located].sort(
    (a, b) => priority(a) - priority(b) || a.span.from - b.span.from,
  );
  const nonOverlapping: typeof located = [];
  for (const sug of byPriority) {
    if (nonOverlapping.some((kept) => overlaps(kept.span, sug.span))) {
      discarded += 1;
      continue;
    }
    nonOverlapping.push(sug);
  }

  const kept = applyDensityCap(nonOverlapping, text);
  const densityCut = nonOverlapping.length - kept.length;
  discarded += densityCut;

  return {
    suggestions: kept
      .sort((a, b) => a.span.from - b.span.from)
      .map((sug, index) => ({
        ...sug,
        id: `${requestId}-${index + 1}`,
      })),
    discarded,
    densityCut,
  };
}

type Located = Omit<Suggestion, 'id'>;

/** Errors first (grammar, anachronisms), then style and pacing, period tips last. */
const priority = (sug: Located): number => {
  if (sug.kind === 'grammar' || sug.aspect === 'anachronism') return 0;
  return sug.kind === 'history' ? 2 : 1;
};

const overlaps = (a: Suggestion['span'], b: Suggestion['span']): boolean =>
  Math.max(a.from, b.from) < Math.min(a.to, b.to);

/**
 * Cuts to the density cap without starving the end of the text: first the errors
 * (grammar, anachronisms), then the best suggestion of each 50-word window they do
 * not cover, spread evenly if that is over the room left; then the rest by priority
 * and text order.
 * `candidates` is sorted by priority, then text order.
 */
function applyDensityCap(candidates: Located[], text: string): Located[] {
  const wordStarts = [...text.matchAll(/\S+/g)].map((match) => match.index);
  const cap = densityCap(wordStarts.length);
  if (candidates.length <= cap) return candidates;

  const windowOf = (from: number): number => {
    let words = 0;
    while (words < wordStarts.length && (wordStarts[words] as number) < from) words += 1;
    return Math.floor(words / WORDS_PER_SUGGESTION);
  };
  // errors first (grammar, anachronisms), counted before any window pick
  const errors = candidates.filter((sug) => priority(sug) === 0).slice(0, cap);
  const covered = new Set(errors.map((sug) => windowOf(sug.span.from)));
  // then the best remaining suggestion of each window not covered yet
  const firstPerWindow = new Map<number, Located>();
  for (const sug of candidates) {
    if (priority(sug) === 0) continue;
    const window = windowOf(sug.span.from);
    if (!covered.has(window) && !firstPerWindow.has(window)) firstPerWindow.set(window, sug);
  }
  const room = cap - errors.length;
  const windowPicks = [...firstPerWindow.values()].sort((x, y) => x.span.from - y.span.from);
  // more windows than room (very long chapters): evenly spaced, so the end is not starved
  const spread =
    windowPicks.length <= room
      ? windowPicks
      : Array.from(
          { length: room },
          (_, i) => windowPicks[Math.floor((i * windowPicks.length) / room)],
        ).filter((sug): sug is Located => sug !== undefined);
  const picked = [...errors, ...spread];
  const chosen = new Set(picked);
  for (const sug of candidates) {
    if (chosen.size >= cap) break;
    chosen.add(sug);
  }
  return candidates.filter((sug) => chosen.has(sug));
}
