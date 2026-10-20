// Mechanical defenses of the contract: discards, hierarchy, cap, ordering.

import { densityCap, normalizeSuggestions, MAX_SUGGESTIONS } from '../normalizeSuggestions';
import { suggestionSchema, type ModelOutput } from '../refineTypes';
import { textHash } from '../textHash';

const TEXT = 'Elena posò lentamente la tazza. Poi uscì fuori e chiuse la porta. Fine della scena.';
const HASH = textHash(TEXT);

function output(suggestions: ModelOutput['suggestions']): ModelOutput {
  return { suggestions };
}

const STYLE_BASE = { kind: 'style' as const, rationale: 'motivo' };

describe('normalizeSuggestions', () => {
  it('locates the originals and produces consistent spans', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'posò lentamente', proposals: ['posò'] },
        { ...STYLE_BASE, kind: 'pacing', original: 'uscì fuori', proposals: ['uscì'] },
      ]),
      TEXT,
      HASH,
      'req-1',
    );
    expect(discarded).toBe(0);
    expect(suggestions).toHaveLength(2);
    const first = suggestions[0];
    expect(first?.span).toEqual({ from: 6, to: 21 });
    expect(TEXT.slice(first?.span.from, first?.span.to)).toBe('posò lentamente');
    expect(first?.state).toBe('pending');
    expect(first?.textHash).toBe(HASH);
    // in text order, ids derived from the requestId
    expect(suggestions.map((s) => s.id)).toEqual(['req-1-1', 'req-1-2']);
    for (const sug of suggestions) expect(suggestionSchema.parse(sug)).toBeTruthy();
  });

  it('discards absent or ambiguous originals (never blind applications)', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'non esiste nel testo', proposals: ['x'] },
        { ...STYLE_BASE, original: 'la', proposals: ['x'] }, // "la" appears more than once
        { ...STYLE_BASE, original: 'uscì fuori', proposals: ['uscì'] },
      ]),
      TEXT,
      HASH,
      'req-2',
    );
    expect(discarded).toBe(2);
    expect(suggestions.map((s) => s.original)).toEqual(['uscì fuori']);
  });

  it('history keeps its aspect and its variants; the other kinds never carry one', () => {
    const scene = 'Napoli, 1943. Nel basso, la madre accese il televisore.';
    const { suggestions } = normalizeSuggestions(
      output([
        {
          kind: 'history',
          aspect: 'period',
          rationale: 'Da verificare: nel 1943 le sirene dell’allarme aereo erano quotidiane.',
          original: 'Napoli, 1943.',
          proposals: [
            'Napoli, 1943. In lontananza suonava la sirena.',
            'Napoli, 1943. Le finestre erano oscurate.',
          ],
        },
        {
          kind: 'history',
          aspect: 'anachronism',
          rationale: 'Da verificare: nel 1943 la televisione in casa non c’era ancora.',
          original: 'il televisore',
          proposals: ['la radio', 'il grammofono'],
        },
        { ...STYLE_BASE, aspect: 'period', original: 'Nel basso,', proposals: ['Nel basso'] },
      ]),
      scene,
      textHash(scene),
      'req-h',
    );
    expect(suggestions.map((s) => [s.kind, s.aspect])).toEqual([
      ['history', 'period'],
      ['style', undefined],
      ['history', 'anachronism'],
    ]);
    expect(suggestions[0]?.proposals).toHaveLength(2);
    expect(suggestions[1]).not.toHaveProperty('aspect');
    for (const sug of suggestions) expect(suggestionSchema.parse(sug)).toBeTruthy();
  });

  it('grammar: keeps only the first proposal (hierarchy)', () => {
    const { suggestions } = normalizeSuggestions(
      output([
        {
          kind: 'grammar',
          rationale: 'motivo',
          original: 'Fine della scena.',
          proposals: ['Fine della scena!', 'Fine!'],
        },
      ]),
      TEXT,
      HASH,
      'req-3',
    );
    expect(suggestions[0]?.proposals).toEqual(['Fine della scena.'.replace('.', '!')]);
  });

  it('empty proposals or ones identical to the original are removed; no proposals left → discard', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'uscì fuori', proposals: ['  ', 'uscì fuori', 'uscì'] },
        { ...STYLE_BASE, original: 'posò lentamente', proposals: ['posò lentamente'] },
      ]),
      TEXT,
      HASH,
      'req-4',
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.proposals).toEqual(['uscì']);
    expect(discarded).toBe(1);
  });

  it('overlapping spans: the first in text order wins', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'lentamente la tazza', proposals: ['la tazza'] },
        { ...STYLE_BASE, original: 'posò lentamente', proposals: ['posò'] },
      ]),
      TEXT,
      HASH,
      'req-5',
    );
    expect(suggestions.map((s) => s.original)).toEqual(['posò lentamente']);
    expect(discarded).toBe(1);
  });

  it('absolute cap: never more than MAX_SUGGESTIONS', () => {
    // 40 suggestions on a text long enough (2000 words) for the density cap to be 30
    const words = Array.from({ length: 40 }, (_, i) => `parola${String(i).padStart(2, '0')}`);
    const longText = [...words, ...Array.from({ length: 1960 }, () => 'e')].join(' ');
    const { suggestions, discarded } = normalizeSuggestions(
      output(words.map((word) => ({ ...STYLE_BASE, original: word, proposals: ['x'] }))),
      longText,
      textHash(longText),
      'req-6',
    );
    expect(suggestions).toHaveLength(MAX_SUGGESTIONS);
    expect(discarded).toBe(40 - MAX_SUGGESTIONS);
  });
});

describe('normalizeSuggestions: whitespace tolerance', () => {
  it('finds a span the model copied with stray leading/trailing whitespace', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      { suggestions: [{ ...STYLE_BASE, original: '\nposò lentamente\t', proposals: ['posò'] }] },
      TEXT,
      HASH,
      'req-ws',
    );
    expect(discarded).toBe(0);
    expect(suggestions[0]?.original).toBe('posò lentamente');
    expect(TEXT.slice(suggestions[0]?.span.from, suggestions[0]?.span.to)).toBe('posò lentamente');
  });

  it('still discards a span that is absent even after trimming', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      { suggestions: [{ ...STYLE_BASE, original: '  non c’è  ', proposals: ['x'] }] },
      TEXT,
      HASH,
      'req-ws2',
    );
    expect(suggestions).toHaveLength(0);
    expect(discarded).toBe(1);
  });
});

describe('normalizeSuggestions: density cap', () => {
  it('densityCap: about one suggestion every 50 words, at least 3, never above 30', () => {
    expect(densityCap(10)).toBe(3);
    expect(densityCap(345)).toBe(7);
    expect(densityCap(361)).toBe(8);
    expect(densityCap(5000)).toBe(MAX_SUGGESTIONS);
  });

  it('cuts to the cap, keeping grammar first and then the text order', () => {
    // 100 words → cap 3; 5 suggestions, the grammar one last in the text
    const words = Array.from({ length: 100 }, (_, i) => `w${String(i).padStart(3, '0')}`);
    const text = words.join(' ');
    const style = (word: string) => ({ ...STYLE_BASE, original: word, proposals: ['x'] });
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        style('w001'),
        style('w010'),
        style('w020'),
        style('w030'),
        { kind: 'grammar', rationale: 'r', original: 'w090', proposals: ['W090'] },
      ]),
      text,
      textHash(text),
      'req-cap',
    );
    expect(suggestions.map((s) => s.original)).toEqual(['w001', 'w010', 'w090']);
    expect(suggestions.map((s) => s.id)).toEqual(['req-cap-1', 'req-cap-2', 'req-cap-3']);
    expect(discarded).toBe(2);
  });
});

describe('normalizeSuggestions: density cap spreads across the text', () => {
  // 200 words → cap 4, four 50-word windows
  const words = Array.from({ length: 200 }, (_, i) => `w${String(i).padStart(3, '0')}`);
  const text = words.join(' ');
  const style = (word: string) => ({ ...STYLE_BASE, original: word, proposals: ['x'] });

  it('keeps one suggestion per 50-word window before filling, so the end is not starved', () => {
    // 8 suggestions crowded at the start, one in each later window
    const crowded = ['w001', 'w002', 'w003', 'w004', 'w005'].map(style);
    const later = ['w060', 'w120', 'w180'].map(style);
    const { suggestions, densityCut } = normalizeSuggestions(
      output([...crowded, ...later]),
      text,
      textHash(text),
      'req-spread',
    );
    expect(suggestions.map((s) => s.original)).toEqual(['w001', 'w060', 'w120', 'w180']);
    expect(densityCut).toBe(4);
  });

  it('grammar wins an overlap with a style span', () => {
    const { suggestions } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'w010 w011 w012', proposals: ['x'] },
        { kind: 'grammar', rationale: 'r', original: 'w011', proposals: ['W011'] },
      ]),
      text,
      textHash(text),
      'req-overlap',
    );
    expect(suggestions.map((s) => s.kind)).toEqual(['grammar']);
  });
});

describe('normalizeSuggestions: history in the density cap', () => {
  it('the cap cuts a period tip before style and keeps the anachronism', () => {
    // 100 words → cap 3; all four in the first 50-word block, so only the ranking decides
    const words = Array.from({ length: 100 }, (_, i) => `w${String(i).padStart(3, '0')}`);
    const text = words.join(' ');
    const { suggestions } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'w001', proposals: ['x'] },
        { ...STYLE_BASE, original: 'w005', proposals: ['x'] },
        {
          kind: 'history',
          aspect: 'period',
          rationale: 'r',
          original: 'w002',
          proposals: ['w002 y'],
        },
        {
          kind: 'history',
          aspect: 'anachronism',
          rationale: 'r',
          original: 'w008',
          proposals: ['z'],
        },
      ]),
      text,
      textHash(text),
      'req-history-cap',
    );
    expect(suggestions.map((s) => s.original)).toEqual(['w001', 'w005', 'w008']);
  });
});

describe('normalizeSuggestions: density cap, grammar and long chapters', () => {
  it('grammar is counted before the one-per-window picks', () => {
    // 200 words → cap 4; seven grammar fixes in the first window, one style pick later on
    const words = Array.from({ length: 200 }, (_, i) => `w${String(i).padStart(3, '0')}`);
    const text = words.join(' ');
    const grammar = ['w001', 'w003', 'w005', 'w007', 'w009', 'w011', 'w013'].map((word) => ({
      kind: 'grammar' as const,
      rationale: 'r',
      original: word,
      proposals: [word.toUpperCase()],
    }));
    const style = ['w060', 'w120', 'w180'].map((word) => ({
      ...STYLE_BASE,
      original: word,
      proposals: ['x'],
    }));
    const { suggestions } = normalizeSuggestions(
      output([...style, ...grammar]),
      text,
      textHash(text),
      'req-grammar-first',
    );
    expect(suggestions.map((s) => s.original)).toEqual(['w001', 'w003', 'w005', 'w007']);
  });

  it('a 2000-word chapter keeps 30 suggestions spread from the start to the end', () => {
    const words = Array.from({ length: 2000 }, (_, i) => `w${String(i).padStart(4, '0')}`);
    const text = words.join(' ');
    // one style suggestion in each of the 40 windows of 50 words
    const picks = Array.from({ length: 40 }, (_, i) => `w${String(i * 50).padStart(4, '0')}`);
    const { suggestions, densityCut } = normalizeSuggestions(
      output(picks.map((word) => ({ ...STYLE_BASE, original: word, proposals: ['x'] }))),
      text,
      textHash(text),
      'req-long',
    );
    expect(suggestions).toHaveLength(MAX_SUGGESTIONS);
    expect(densityCut).toBe(10);
    expect(suggestions[0]?.original).toBe('w0000');
    // the last windows are still represented
    expect(suggestions.some((s) => s.span.from > text.indexOf('w1800'))).toBe(true);
  });
});
