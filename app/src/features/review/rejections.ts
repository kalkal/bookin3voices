// Rejected suggestions are never proposed again: every refinement sends the
// keys of the (original, proposal) pairs the user rejected, and the server drops
// them (normalizeSuggestions, the one central place). Only keys travel.
// TWIN of functions/src/ai/rejections.ts (same reference vectors).

import type { RevisionRecord } from './ReviewSession';
import { textHash } from './textHash';

/** The server accepts at most this many keys per refinement (newest kept). */
export const MAX_REJECTED_KEYS = 500;

/** Key of a rejected pair: the same original with the same proposal. */
export function rejectionKey(original: string, proposal: string): string {
  return textHash(`${original}\u0000${proposal}`);
}

/** Keys of every rejected proposal (alternatives included), newest first, no duplicates. */
export function rejectedKeys(revisions: readonly RevisionRecord[]): string[] {
  const keys = new Set<string>();
  const newestFirst = [...revisions].sort((a, b) => b.at - a.at);
  for (const revision of newestFirst) {
    if (revision.decision !== 'rejected') continue;
    for (const proposal of [revision.after, ...(revision.alternatives ?? [])]) {
      keys.add(rejectionKey(revision.before, proposal));
    }
  }
  return [...keys].slice(0, MAX_REJECTED_KEYS);
}
