// Normalizzazione dell'output del modello in suggerimenti ancorati al testo.
// Qui vivono le difese meccaniche del contratto:
// - `original` che non compare nel testo o compare più di una volta → SCARTATO
//   (mai un'applicazione cieca);
// - proposte vuote o identiche all'original → rimosse; senza proposte → scartato;
// - grammar con più proposte → si tiene la prima (la più conservativa per
//   costruzione del prompt), gerarchia delle proposte;
// - tetto di densità della Style Bible: mai più di 30 suggerimenti, in ordine
//   di testo;
// - span sovrapposti → si tiene il primo in ordine di testo (l'app non
//   gestisce evidenziazioni sovrapposte).

import type { ModelOutput, Suggestion } from './refineTypes';

export interface NormalizedSuggestions {
  suggestions: Suggestion[];
  /** Quanti suggerimenti del modello sono stati scartati (diagnostica). */
  discarded: number;
}

export const MAX_SUGGESTIONS = 30;

/** Tutte le occorrenze di `needle` in `haystack` (indici di partenza). */
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
  const located: Array<Omit<Suggestion, 'id'>> = [];
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
      discarded += 1; // assente o ambiguo: mai indovinare lo span
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
      span: { from, to: from + raw.original.length },
      original: raw.original,
      proposals,
      rationale: raw.rationale,
      state: 'pending',
      textHash: hash,
    });
  }

  located.sort((a, b) => a.span.from - b.span.from);

  const nonOverlapping: typeof located = [];
  let lastEnd = -1;
  for (const sug of located) {
    if (sug.span.from < lastEnd) {
      discarded += 1;
      continue;
    }
    nonOverlapping.push(sug);
    lastEnd = sug.span.to;
  }

  discarded += Math.max(0, nonOverlapping.length - MAX_SUGGESTIONS);

  return {
    suggestions: nonOverlapping.slice(0, MAX_SUGGESTIONS).map((sug, index) => ({
      ...sug,
      id: `${requestId}-${index + 1}`,
    })),
    discarded,
  };
}
