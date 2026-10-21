// «Rifinisci la selezione»: the app side of the rule in
// functions/src/ai/refineSelection.ts (same minimum, pinned by selection.test.ts).

import type { Span } from './types';

/** Fewer selected words give the model nothing to work on. */
export const MIN_SELECTION_WORDS = 5;

export function selectionWords(text: string, range: Span): number {
  return text.slice(range.from, range.to).match(/\S+/g)?.length ?? 0;
}
