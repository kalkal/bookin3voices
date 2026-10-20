// FAKE suggestions provider (Strategy): generates plausible, mechanically
// correct suggestions locally (matching spans, 1-3 proposals, text hash) to
// build and exercise the review experience BEFORE the `refineChapter` function
// exists, which will replace it behind the same SuggestionsProvider interface.
//
// The rules follow the categories of the golden set
// (content/style-profiles/suspense/golden-set/): -mente adverbs and filter
// verbs (style), dictation slips such as elisions and lowercase (grammar),
// long sentences to split (pacing). It is NOT a style model: it is a
// deterministic generator for UI and tests; real suggestion quality is the
// job of the refineChapter callable and of human editorial judgment.

import { textHash } from './textHash';
import type { RefineRequest, RefineResult, Suggestion, SuggestionsProvider } from './types';

/** Golden-set density: 5-8 suggestions per passage, never a downpour. */
const MAX_SUGGESTIONS = 8;

/** Common feminine nouns that take elision after «un» (dictation slip). */
const FEMININE_AFTER_UN = ['altra', 'amica', 'idea', 'intera', 'ombra', 'ora', 'ultima', 'unica'];

/** Filter verbs flagged by the golden set: direct perception is stronger. */
const FILTER_VERBS = ['sentì che', 'vide che', 'capì che', 'pensò che', 'si rese conto che'];

export interface FakeSuggestionsProviderOptions {
  /** Simulated delay of the "call" (0 in tests, ~700ms in the app). */
  delayMs?: number;
}

export class FakeSuggestionsProvider implements SuggestionsProvider {
  private readonly delayMs: number;

  constructor(options: FakeSuggestionsProviderOptions = {}) {
    this.delayMs = options.delayMs ?? 0;
  }

  async refine(request: RefineRequest): Promise<RefineResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }
    const { text } = request;
    const found = [
      ...findAdverbs(text),
      ...findFilterVerbs(text),
      ...findMissingElisions(text),
      ...findLowercaseSentenceStarts(text),
      ...findLongSentences(text),
    ].sort((a, b) => a.span.from - b.span.from);

    // no overlapping spans in the same batch: keep the first
    const kept: Draft[] = [];
    for (const draft of found) {
      const last = kept[kept.length - 1];
      if (last && draft.span.from < last.span.to) continue;
      kept.push(draft);
      if (kept.length === MAX_SUGGESTIONS) break;
    }

    const hash = textHash(text);
    const suggestions: Suggestion[] = kept.map((draft, index) => ({
      id: `fake-${hash}-${index}`,
      kind: draft.kind,
      span: draft.span,
      original: text.slice(draft.span.from, draft.span.to),
      proposals: draft.proposals,
      rationale: draft.rationale,
      state: 'pending',
      textHash: hash,
    }));
    return { textHash: hash, suggestions };
  }
}

interface Draft {
  kind: Suggestion['kind'];
  span: { from: number; to: number };
  proposals: string[];
  rationale: string;
}

/** «posò lentamente» → 3 style variants without the -mente adverb. */
function findAdverbs(text: string): Draft[] {
  const drafts: Draft[] = [];
  const regex = /(\p{L}+) (\p{L}{3,}mente)\b/gu;
  for (const match of text.matchAll(regex)) {
    const [whole, verb] = match;
    drafts.push({
      kind: 'style',
      span: { from: match.index, to: match.index + whole.length },
      proposals: [verb, `${verb}, piano,`, `${verb} senza fretta`],
      rationale: 'L’avverbio in -mente smorza il gesto: meglio un verbo secco.',
    });
  }
  return drafts;
}

/**
 * «sentì che qualcosa non andava» → «qualcosa non andava»: the span covers the
 * filter verb AND the next word, and the proposal keeps only the latter, so
 * the patch is never a deletion with an empty proposal (schema).
 */
function findFilterVerbs(text: string): Draft[] {
  const drafts: Draft[] = [];
  for (const filter of FILTER_VERBS) {
    let from = text.indexOf(filter);
    while (from !== -1) {
      const afterFilter = from + filter.length;
      const next = text.slice(afterFilter).match(/^ (\p{Ll}\p{L}*)/u);
      if (next) {
        drafts.push({
          kind: 'style',
          span: { from, to: afterFilter + next[0].length },
          proposals: [next[1]],
          rationale: 'Verbo filtro: la percezione diretta è più forte.',
        });
      }
      from = text.indexOf(filter, from + 1);
    }
  }
  return drafts;
}

/** «un altra» → «un'altra»: a single proposal (grammar). */
function findMissingElisions(text: string): Draft[] {
  const drafts: Draft[] = [];
  const regex = new RegExp(`\\bun (${FEMININE_AFTER_UN.join('|')})\\b`, 'gu');
  for (const match of text.matchAll(regex)) {
    drafts.push({
      kind: 'grammar',
      span: { from: match.index, to: match.index + match[0].length },
      proposals: [`un'${match[1]}`],
      rationale: 'Elisione: apostrofo davanti al femminile.',
    });
  }
  return drafts;
}

/** «. aprì la finestra» → capital after the period (dictation slip). */
function findLowercaseSentenceStarts(text: string): Draft[] {
  const drafts: Draft[] = [];
  const regex = /[.!?]\s+(\p{Ll})/gu;
  for (const match of text.matchAll(regex)) {
    const from = match.index + match[0].length - 1;
    drafts.push({
      kind: 'grammar',
      span: { from, to: from + 1 },
      proposals: [match[1].toUpperCase()],
      rationale: 'Maiuscola dopo il punto: refuso tipico della dettatura.',
    });
  }
  return drafts;
}

/** Word count beyond which a dictated sentence calls for a pacing split. */
const LONG_SENTENCE_WORDS = 45;

/** Very long sentence → split it at a central «e»: a single, cautious proposal. */
function findLongSentences(text: string): Draft[] {
  const drafts: Draft[] = [];
  const sentenceRegex = /[^.!?]+[.!?]?/g;
  for (const match of text.matchAll(sentenceRegex)) {
    const sentence = match[0];
    const words = sentence.trim().split(/\s+/);
    if (words.length <= LONG_SENTENCE_WORDS) continue;
    // the « e word» closest to the middle of the sentence
    const eRegex = / e (\p{Ll}\p{L}*)/gu;
    const middle = match.index + sentence.length / 2;
    let best: { from: number; whole: string; word: string } | null = null;
    for (const e of sentence.matchAll(eRegex)) {
      const from = match.index + e.index;
      if (!best || Math.abs(from - middle) < Math.abs(best.from - middle)) {
        best = { from, whole: e[0], word: e[1] };
      }
    }
    if (!best) continue;
    const capitalized = best.word[0].toUpperCase() + best.word.slice(1);
    drafts.push({
      kind: 'pacing',
      span: { from: best.from, to: best.from + best.whole.length },
      proposals: [`. ${capitalized}`],
      rationale: 'Frase molto lunga: una spezzatura qui le ridà fiato.',
    });
  }
  return drafts;
}
