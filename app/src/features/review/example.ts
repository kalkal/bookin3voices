// Example suggestions: pre-recorded refine results for the bundled sample book,
// served only when the live AI cannot answer (judges' build). They travel
// through the same contract as live ones; what sets them apart is the id
// prefix, so every screen can label them and never pass them off as live AI.

import type { Suggestion } from './types';

/** Every pre-recorded suggestion id starts with this prefix (and live ones never do). */
export const EXAMPLE_SUGGESTION_ID_PREFIX = 'example-';

/** True for a pre-recorded example suggestion, never for a live AI one. */
export function isExampleSuggestion(suggestion: Pick<Suggestion, 'id'>): boolean {
  return suggestion.id.startsWith(EXAMPLE_SUGGESTION_ID_PREFIX);
}
