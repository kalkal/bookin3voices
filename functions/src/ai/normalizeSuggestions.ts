// Normalization of the model output into text-anchored suggestions.
// The mechanical defenses of the contract live here:
// - an `original` that is absent from the text or appears more than once →
//   DISCARDED (never a blind application);
// - empty proposals, or ones identical to the original → removed; with no
//   proposals left → discarded;
// - proposals that replace their original instead of changing it → removed
//   (proposalGuard: grammar is a small edit, style/pacing keep part of the
//   original); with no proposals left → discarded;
// - proposals the user already rejected on the same original (rejections.ts)
//   → removed, so a new refinement never proposes them again;
// - grammar with several proposals → keep the first (the most conservative by
//   prompt design), per the proposal hierarchy;
// - `aspect` is kept on history only (parseModelOutput already dropped a
//   history without one);
// - Style Bible density cap, enforced here because the model does not keep it
//   (Nova golden run, 20/10: 16 suggestions on 345 words): about one every 50
//   words, at least 3, never more than 30. Over the cap the errors (grammar
//   and anachronisms) are kept first, then the best suggestion of each 50-word
//   window they do not cover (so the end of the text is not starved), then the
//   rest by priority (style and pacing, period tips last) and in text order;
// - overlapping spans → the higher priority wins, then the first in text order
//   (the app does not handle overlapping highlights).

import { checkProposal, type ProposalDropReason } from './proposalGuard';
import { rejectionKey } from './rejections';
import type { ModelOutput, Suggestion } from './refineTypes';

/** Why a model suggestion did not survive normalization (stable codes). */
export type DropReason =
  | 'original-not-found'
  | 'original-ambiguous'
  | 'no-proposals'
  /** every proposal would have deleted or replaced text (proposalGuard) */
  | 'unsafe-proposals'
  /** every proposal was already rejected by the user on this original */
  | 'already-rejected'
  | 'overlap'
  | 'density-cap'
  /** the user turned this kind off for the refinement */
  | 'kind-off';

/** A single proposal removed before the suggestion was kept or dropped. */
export interface DroppedProposal {
  kind: Suggestion['kind'];
  original: string;
  proposal: string;
  reason: ProposalDropReason | 'already-rejected';
}

export interface DroppedSuggestion {
  kind: Suggestion['kind'];
  original: string;
  proposals: string[];
  reason: DropReason;
}

export interface NormalizedSuggestions {
  suggestions: Suggestion[];
  /** Each discarded suggestion with its reason (diagnostics, the dev trace). */
  droppedItems: DroppedSuggestion[];
  /** Each proposal removed by the guard or as already rejected, with its reason (dev trace). */
  droppedProposals: DroppedProposal[];
  /** How many model suggestions were discarded (diagnostics), density cut included. */
  discarded: number;
  /** How many valid suggestions the density cap removed (part of `discarded`). */
  densityCut: number;
  /** How many proposals the proposal guard removed (they would have deleted or replaced text). */
  unsafe: number;
  /** How many proposals were dropped because the user had already rejected them. */
  alreadyRejected: number;
}

export interface NormalizeOptions {
  /** rejectionKey of every (original, proposal) pair the user rejected. */
  rejected?: ReadonlySet<string>;
  /**
   * «Rifinisci la selezione»: originals are located inside [from, to) only (exactly
   * once there), density is measured on the selection, and spans come back shifted
   * to the whole text.
   */
  range?: { from: number; to: number };
  /** Kinds the user chose; suggestions of other kinds are dropped ('kind-off'). */
  kinds?: readonly Suggestion['kind'][];
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
  options: NormalizeOptions = {},
): NormalizedSuggestions {
  const located: Located[] = [];
  // spans are computed inside the scope, then shifted to the whole text
  const scope = options.range ? text.slice(options.range.from, options.range.to) : text;
  const offset = options.range?.from ?? 0;
  const droppedItems: DroppedSuggestion[] = [];
  const droppedProposals: DroppedProposal[] = [];
  const drop = (
    sug: { kind: Suggestion['kind']; original: string; proposals: string[] },
    reason: DropReason,
  ) =>
    droppedItems.push({ kind: sug.kind, original: sug.original, proposals: sug.proposals, reason });

  for (const rawSuggestion of output.suggestions) {
    if (options.kinds !== undefined && !options.kinds.includes(rawSuggestion.kind)) {
      drop(rawSuggestion, 'kind-off');
      continue;
    }
    // models often add stray leading/trailing whitespace when copying a span:
    // retry with the trimmed span before giving up (still exactly-one match)
    let raw = rawSuggestion;
    let occurrences = occurrencesOf(scope, raw.original);
    const trimmed = raw.original.trim();
    if (occurrences.length === 0 && trimmed !== '' && trimmed !== raw.original) {
      raw = { ...rawSuggestion, original: trimmed };
      occurrences = occurrencesOf(scope, trimmed);
    }
    if (occurrences.length !== 1) {
      // absent or ambiguous: never guess the span
      drop(rawSuggestion, occurrences.length === 0 ? 'original-not-found' : 'original-ambiguous');
      continue;
    }
    const from = occurrences[0] as number;

    let proposals = raw.proposals
      .map((proposal) => proposal.trim())
      .filter((proposal) => proposal !== '' && proposal !== raw.original);
    const before = droppedProposals.length;
    proposals = proposals.filter((proposal) => {
      const verdict = checkProposal(raw.kind, raw.original, proposal);
      if (!verdict.ok) {
        droppedProposals.push({
          kind: raw.kind,
          original: raw.original,
          proposal,
          reason: verdict.reason,
        });
        return false;
      }
      if (options.rejected?.has(rejectionKey(raw.original, proposal))) {
        droppedProposals.push({
          kind: raw.kind,
          original: raw.original,
          proposal,
          reason: 'already-rejected',
        });
        return false;
      }
      return true;
    });
    if (raw.kind === 'grammar') proposals = proposals.slice(0, 1);
    if (proposals.length === 0) {
      // say why: the guard or a past rejection emptied it, or the model sent nothing usable
      const mine = droppedProposals.slice(before);
      drop(
        raw,
        mine.some((d) => d.reason !== 'already-rejected')
          ? 'unsafe-proposals'
          : mine.length > 0
            ? 'already-rejected'
            : 'no-proposals',
      );
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
      drop(sug, 'overlap');
      continue;
    }
    nonOverlapping.push(sug);
  }

  const kept = applyDensityCap(nonOverlapping, scope);
  const densityCut = nonOverlapping.length - kept.length;
  const keptSet = new Set(kept);
  for (const sug of nonOverlapping) if (!keptSet.has(sug)) drop(sug, 'density-cap');

  return {
    suggestions: kept
      .sort((a, b) => a.span.from - b.span.from)
      .map((sug, index) => ({
        ...sug,
        span: { from: sug.span.from + offset, to: sug.span.to + offset },
        id: `${requestId}-${index + 1}`,
      })),
    droppedItems,
    droppedProposals,
    discarded: droppedItems.length,
    densityCut,
    unsafe: droppedProposals.filter((d) => d.reason !== 'already-rejected').length,
    alreadyRejected: droppedProposals.filter((d) => d.reason === 'already-rejected').length,
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

/** Why a refinement returned no suggestions (a code for the app, never text). */
export type EmptyReason =
  'nothing-to-fix' | 'unsafe-dropped' | 'already-rejected' | 'nothing-usable';

export function emptyReasonOf(normalized: NormalizedSuggestions): EmptyReason | undefined {
  if (normalized.suggestions.length > 0) return undefined;
  if (normalized.unsafe > 0) return 'unsafe-dropped';
  if (normalized.alreadyRejected > 0) return 'already-rejected';
  if (normalized.droppedItems.length > 0) return 'nothing-usable';
  return 'nothing-to-fix';
}
