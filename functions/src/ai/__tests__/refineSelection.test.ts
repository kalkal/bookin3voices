// «Rifinisci la selezione»: only the selected range is refined, the chapter is
// context; suggestions are anchored inside the range and spans shifted to the
// whole text; pending suggestions are replaced only inside the range.

import { buildRefineDebugTrace } from '../debugTrace';
import { normalizeSuggestions } from '../normalizeSuggestions';
import { buildRefinePrompt } from '../refinePrompt';
import { refineChapterInputSchema, type ModelOutput } from '../refineTypes';
import { MIN_SELECTION_WORDS, pendingToReplace, selectionProblem } from '../refineSelection';
import { textHash } from '../textHash';

const TEXT =
  'Elena posò lentamente la tazza sul tavolo. Poi uscì fuori e chiuse la porta. Elena posò lentamente il libro.';
const HASH = textHash(TEXT);
const SECOND = 'Poi uscì fuori e chiuse la porta.';
const RANGE = { from: TEXT.indexOf(SECOND), to: TEXT.indexOf(SECOND) + SECOND.length };
const out = (suggestions: ModelOutput['suggestions']): ModelOutput => ({ suggestions });

describe('input', () => {
  const base = { bookId: 'b', chapterId: 'c', text: 't', textHash: 'v1-x', requestId: 'r1' };
  it('takes an optional range {from, to}', () => {
    expect(refineChapterInputSchema.safeParse({ ...base, range: { from: 0, to: 1 } }).success).toBe(
      true,
    );
    expect(refineChapterInputSchema.safeParse(base).success).toBe(true);
    expect(
      refineChapterInputSchema.safeParse({ ...base, range: { from: -1, to: 1 } }).success,
    ).toBe(false);
  });

  it('selectionProblem: out of the text, empty or too short → a reason', () => {
    expect(selectionProblem(TEXT, RANGE)).toBeNull();
    expect(selectionProblem(TEXT, { from: 5, to: 5 })).toBe('empty');
    expect(selectionProblem(TEXT, { from: 0, to: TEXT.length + 1 })).toBe('out-of-range');
    expect(selectionProblem(TEXT, { from: 0, to: 'Elena posò'.length })).toBe('too-short');
    expect(MIN_SELECTION_WORDS).toBe(5);
  });
});

describe('prompt', () => {
  const base = {
    styleBible: 'SB',
    fewShots: 'FS',
    book: { title: 'T', genre: '', language: 'it', synopsis: '' },
    chapter: { title: 'C', outline: null },
    text: TEXT,
  };

  it('with a selection: the chapter is context only, the selection is what gets refined', () => {
    const prompt = buildRefinePrompt({ ...base, selection: SECOND });
    expect(prompt.userText).toContain('solo contesto');
    expect(prompt.userText).toContain(TEXT);
    expect(prompt.userText).toMatch(
      /Parte da rifinire[^<]*<<<\nPoi uscì fuori e chiuse la porta\.\n>>>/,
    );
  });

  it('without a selection the prompt is unchanged', () => {
    expect(buildRefinePrompt(base).userText).not.toContain('Parte da rifinire');
  });
});

describe('normalizeSuggestions with a range', () => {
  it('finds originals inside the range only and shifts spans to the whole text', () => {
    const result = normalizeSuggestions(
      out([
        { kind: 'pacing', original: 'uscì fuori', proposals: ['uscì'], rationale: 'pleonasmo' },
        // also outside the range, but unique inside it: anchored inside
        {
          kind: 'style',
          original: 'chiuse la porta',
          proposals: ['chiuse piano la porta'],
          rationale: 'r',
        },
        // only outside the range: dropped, never applied there
        { kind: 'style', original: 'la tazza sul tavolo', proposals: ['la tazza'], rationale: 'r' },
      ]),
      TEXT,
      HASH,
      'req',
      { range: RANGE },
    );
    expect(result.suggestions.map((s) => s.original)).toEqual(['uscì fuori', 'chiuse la porta']);
    for (const s of result.suggestions) {
      expect(TEXT.slice(s.span.from, s.span.to)).toBe(s.original);
      expect(s.span.from).toBeGreaterThanOrEqual(RANGE.from);
      expect(s.span.to).toBeLessThanOrEqual(RANGE.to);
      expect(s.textHash).toBe(HASH);
    }
    expect(result.droppedItems.map((d) => [d.original, d.reason])).toEqual([
      ['la tazza sul tavolo', 'original-not-found'],
    ]);
  });

  it('an original repeated outside the range but unique inside is fine; the guard still applies', () => {
    const range = { from: TEXT.lastIndexOf('Elena'), to: TEXT.length };
    const result = normalizeSuggestions(
      out([
        { kind: 'style', original: 'posò lentamente', proposals: ['posò'], rationale: 'avverbio' },
        {
          kind: 'style',
          original: 'il libro',
          proposals: ['Fuori pioveva da ore e nessuno parlò.'],
          rationale: 'r',
        },
      ]),
      TEXT,
      HASH,
      'req',
      { range },
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.span.from).toBe(TEXT.lastIndexOf('posò lentamente'));
    expect(result.unsafe).toBe(1);
  });
});

describe('pendingToReplace', () => {
  const pending = (id: string, from: number, to: number, hash = HASH) => ({
    id,
    span: { from, to },
    textHash: hash,
  });

  it('whole chapter: every pending is replaced', () => {
    expect(pendingToReplace([pending('a', 0, 5), pending('b', 50, 60)], HASH, undefined)).toEqual([
      'a',
      'b',
    ]);
  });

  it('a range: only pendings touching it, plus those on an older text', () => {
    expect(
      pendingToReplace(
        [
          pending('before', 0, 5),
          pending('inside', RANGE.from + 4, RANGE.from + 10),
          pending('straddling', RANGE.to - 3, RANGE.to + 4),
          pending('after', RANGE.to + 2, RANGE.to + 9),
          pending('old', 0, 5, 'v1-older'),
        ],
        HASH,
        RANGE,
      ),
    ).toEqual(['inside', 'straddling', 'old']);
  });
});

describe('debug trace', () => {
  it('records the range (offsets and words, never more text)', () => {
    const t = buildRefineDebugTrace({
      promptVersion: 1,
      model: 'm',
      book: { genre: '', language: 'it', synopsis: '', styleProfileId: null },
      chapter: { title: '', outline: null },
      text: TEXT,
      textHash: HASH,
      raw: [],
      parseDropped: 0,
      history: null,
      merged: [],
      normalized: normalizeSuggestions(out([]), TEXT, HASH, 'r', { range: RANGE }),
      range: RANGE,
    });
    expect(t.context.range).toEqual({ ...RANGE, words: 7 });
  });
});
