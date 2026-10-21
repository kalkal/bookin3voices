// «Rifinisci la selezione»: the user refines only a range of the chapter.
// The rules that do not need Firestore live here, so they are unit-tested:
// - a selection must sit inside the text and hold at least MIN_SELECTION_WORDS
//   words (fewer gives the model nothing to work on);
// - a new refinement replaces the undecided pending suggestions only where it
//   looked: the ones touching the range, plus any left on an older text (their
//   spans no longer mean anything). Pendings elsewhere stay.

/** A selection of the chapter text, [from, to) in UTF-16 offsets. */
export interface SelectionRange {
  from: number;
  to: number;
}

export const MIN_SELECTION_WORDS = 5;

export type SelectionProblem = 'out-of-range' | 'empty' | 'too-short';

export function selectionProblem(text: string, range: SelectionRange): SelectionProblem | null {
  if (range.from < 0 || range.to > text.length || range.from > range.to) return 'out-of-range';
  const selected = text.slice(range.from, range.to);
  if (selected.trim() === '') return 'empty';
  const words = selected.match(/\S+/g)?.length ?? 0;
  return words < MIN_SELECTION_WORDS ? 'too-short' : null;
}

/** Ids of the pending suggestions a refinement replaces (all of them without a range). */
export function pendingToReplace(
  pendings: readonly { id: string; span: SelectionRange; textHash: string }[],
  textHash: string,
  range: SelectionRange | undefined,
): string[] {
  if (range === undefined) return pendings.map((p) => p.id);
  return pendings
    .filter(
      (p) =>
        p.textHash !== textHash ||
        Math.max(p.span.from, range.from) < Math.min(p.span.to, range.to),
    )
    .map((p) => p.id);
}
