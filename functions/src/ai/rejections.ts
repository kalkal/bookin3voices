// Rejected suggestions are never proposed again. The app sends one compact key
// per rejected (original, proposal) pair (no extra text travels), and
// normalizeSuggestions drops those proposals: ONE central place.
// TWIN of app/src/features/review/rejections.ts (same reference vectors).

import { textHash } from './textHash';

/** Key of a rejected pair: the same original with the same proposal. */
export function rejectionKey(original: string, proposal: string): string {
  return textHash(`${original}\u0000${proposal}`);
}
