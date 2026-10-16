// Provider FINTO di suggerimenti (Strategy): genera in locale suggerimenti
// plausibili e meccanicamente corretti (span che combaciano, 1–3 proposte,
// hash del testo) per costruire e collaudare l'esperienza di review PRIMA che
// esista la function `refineChapter`, che lo sostituirà dietro la stessa
// interfaccia SuggestionsProvider.
//
// Le regole si ispirano alle categorie del golden set
// (content/style-profiles/suspense/golden-set/): avverbi in -mente e verbi
// filtro (style), refusi di dettatura come elisioni e minuscole (grammar),
// frasi lunghe da spezzare (pacing). NON è un modello di stile: è un generatore
// deterministico per UI e test — la qualità vera dei suggerimenti è materia
// della callable refineChapter e del giudizio editoriale umano.

import { textHash } from './textHash';
import type { RefineRequest, RefineResult, Suggestion, SuggestionsProvider } from './types';

/** Densità del golden set: 5–8 suggerimenti per brano, mai una pioggia. */
const MAX_SUGGESTIONS = 8;

/** Femminili comuni che dopo «un» vogliono l'elisione (refuso da dettatura). */
const FEMININE_AFTER_UN = ['altra', 'amica', 'idea', 'intera', 'ombra', 'ora', 'ultima', 'unica'];

/** Verbi filtro segnalati dal golden set: la percezione diretta è più forte. */
const FILTER_VERBS = ['sentì che', 'vide che', 'capì che', 'pensò che', 'si rese conto che'];

export interface FakeSuggestionsProviderOptions {
  /** Ritardo simulato della "chiamata" (0 nei test, ~700ms nell'app). */
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

    // niente span sovrapposti nello stesso lotto: si tiene il primo
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

/** «posò lentamente» → 3 varianti di stile senza l'avverbio in -mente. */
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
 * «sentì che qualcosa non andava» → «qualcosa non andava»: lo span copre il
 * verbo filtro E la parola successiva, la proposta tiene solo quest'ultima —
 * così la patch non è mai una cancellazione a proposta vuota (schema).
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

/** «un altra» → «un'altra»: una sola proposta (grammatica). */
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

/** «. aprì il rubinetto» → maiuscola dopo il punto (refuso di dettatura). */
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

/** Parole oltre cui una frase dettata chiede una spezzatura di ritmo. */
const LONG_SENTENCE_WORDS = 45;

/** Frase molto lunga → spezzarla su una «e» centrale: proposta unica, prudente. */
function findLongSentences(text: string): Draft[] {
  const drafts: Draft[] = [];
  const sentenceRegex = /[^.!?]+[.!?]?/g;
  for (const match of text.matchAll(sentenceRegex)) {
    const sentence = match[0];
    const words = sentence.trim().split(/\s+/);
    if (words.length <= LONG_SENTENCE_WORDS) continue;
    // la « e parola» più vicina al centro della frase
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
