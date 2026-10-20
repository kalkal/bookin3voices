// FAKE suggestions provider (Strategy): generates plausible, mechanically
// correct suggestions locally (matching spans, 1-3 proposals, text hash) to
// build and exercise the review experience BEFORE the `refineChapter` function
// exists, which will replace it behind the same SuggestionsProvider interface.
//
// The rules follow the categories of the golden set
// (content/style-profiles/suspense/golden-set/): -mente adverbs and filter
// verbs (style), dictation slips such as elisions and lowercase (grammar),
// long sentences to split (pacing). History has two parts, both phrased as
// hints to check: a period detail for a year it knows
// (history/period) and objects that did not exist yet (history/anachronism);
// no recognisable period, no history at all. It is NOT a style model: it is a
// deterministic generator for UI and tests; real suggestion quality is the
// job of the refineChapter callable and of human editorial judgment.

import { textHash } from './textHash';
import type {
  HistoryAspect,
  RefineRequest,
  RefineResult,
  Suggestion,
  SuggestionsProvider,
} from './types';

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
      ...findHistory(text),
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
      ...(draft.aspect ? { aspect: draft.aspect } : {}),
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
  aspect?: HistoryAspect;
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

/**
 * The year a passage is set in: the first year it names up to 1979
 * («Napoli, 1943.»). Later years and texts without one are contemporary.
 */
const SETTING_YEAR = /(?<!\d)(1[0-8]\d{2}|19[0-7]\d)(?!\d)/;

interface Period {
  from: number;
  to: number;
  /** Why the details fit, after «Da verificare: nel <year>». */
  why: string;
  /** Sentences that could follow the one naming the year. */
  details: string[];
}

/** The few periods the fake knows: any other year gets no history at all, never a guess. */
const PERIODS: Period[] = [
  {
    from: 1880,
    to: 1899,
    why: 'le strade di città avevano lampioni a gas, carrozze a cavalli e venditori ambulanti che gridavano la merce',
    details: [
      'I lampioni a gas si accendevano uno dopo l’altro.',
      'Sul selciato passò una carrozza.',
    ],
  },
  {
    from: 1940,
    to: 1945,
    why: 'in tempo di guerra sirene dell’allarme aereo, tessere annonarie e oscuramento erano parte della vita di ogni giorno',
    details: [
      'In lontananza suonava la sirena dell’allarme aereo.',
      'Le finestre erano oscurate, come ogni sera.',
      'In tasca, la tessera annonaria.',
    ],
  },
  {
    from: 1955,
    to: 1969,
    why: 'gli anni del boom avevano la Vespa, il juke-box nei bar e il telefono a gettoni',
    details: ['Da un bar arrivava la musica di un juke-box.', 'Una Vespa passò sotto le finestre.'],
  },
];

interface PeriodObject {
  /** The thing, as it is named in the rationale. */
  name: string;
  /** What is matched in the text: article included, so the proposals agree. */
  term: string;
  /** Roughly when it enters ordinary Italian homes and speech. */
  since: number;
  /** What the period had instead, the most conservative first. */
  proposals: string[];
}

const PERIOD_OBJECTS: PeriodObject[] = [
  {
    name: 'televisore',
    term: 'il televisore',
    since: 1954,
    proposals: ['la radio', 'il grammofono'],
  },
  {
    name: 'cellulare',
    term: 'il cellulare',
    since: 1990,
    proposals: ['il telefono', 'il telegramma'],
  },
  { name: 'computer', term: 'il computer', since: 1980, proposals: ['la macchina da scrivere'] },
  { name: 'biro', term: 'la biro', since: 1950, proposals: ['la stilografica', 'la matita'] },
];

/** «Napoli, 1943. … il televisore» → a period detail on the year's sentence, a warning on the object. */
function findHistory(text: string): Draft[] {
  const setting = SETTING_YEAR.exec(text);
  if (!setting) return [];
  const year = Number(setting[1]);
  const period = PERIODS.find((p) => year >= p.from && year <= p.to);
  if (!period) return [];

  // the sentence that names the year, with its closing punctuation
  const from = text.slice(0, setting.index).search(/[^.!?\s][^.!?]*$/);
  const start = from === -1 ? setting.index : from;
  const end = text.slice(setting.index).search(/[.!?]/);
  const to = end === -1 ? text.length : setting.index + end + 1;
  const sentence = text.slice(start, to);

  const drafts: Draft[] = [
    {
      kind: 'history',
      aspect: 'period',
      span: { from: start, to },
      proposals: period.details.map((detail) => `${sentence} ${detail}`),
      rationale: `Da verificare: nel ${year} ${period.why}. Un dettaglio così dà vita alla scena.`,
    },
  ];

  for (const { name, term, since, proposals } of PERIOD_OBJECTS) {
    if (year >= since) continue;
    const regex = new RegExp(`(?<!\\p{L})${term}(?!\\p{L})`, 'giu');
    for (const match of text.matchAll(regex)) {
      const capitalized = match[0][0] !== match[0][0].toLowerCase();
      drafts.push({
        kind: 'history',
        aspect: 'anachronism',
        span: { from: match.index, to: match.index + match[0].length },
        proposals: proposals.map((p) => (capitalized ? p[0].toUpperCase() + p.slice(1) : p)),
        rationale: `Da verificare: nel ${year} «${name}» non era ancora d’uso comune (in Italia si diffonde verso il ${since}).`,
      });
    }
  }
  return drafts;
}
