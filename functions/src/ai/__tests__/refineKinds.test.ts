// The owner picks which kinds of suggestions a refinement checks (style,
// grammar, pacing, history/period). Kinds turned off yield no suggestions; the
// history check runs only with «period» on; the prompt lists only the chosen ones.

import { normalizeSuggestions } from '../normalizeSuggestions';
import { buildRefinePrompt } from '../refinePrompt';
import { mainKindsOf, refineChapterInputSchema, type ModelOutput } from '../refineTypes';
import { pendingToReplace } from '../refineSelection';
import { textHash } from '../textHash';

const TEXT = 'Elena posò lentamente la tazza. Poi uscì fuori e chiuse la porta.';
const out = (suggestions: ModelOutput['suggestions']): ModelOutput => ({ suggestions });

describe('input', () => {
  const base = { bookId: 'b', chapterId: 'c', text: 't', textHash: 'v1-x', requestId: 'r1' };
  it('kinds is an optional, non-empty set of the four kinds', () => {
    expect(
      refineChapterInputSchema.safeParse({ ...base, kinds: ['grammar', 'history'] }).success,
    ).toBe(true);
    expect(refineChapterInputSchema.safeParse(base).success).toBe(true);
    expect(refineChapterInputSchema.safeParse({ ...base, kinds: [] }).success).toBe(false);
    expect(refineChapterInputSchema.safeParse({ ...base, kinds: ['spelling'] }).success).toBe(
      false,
    );
  });

  it('mainKindsOf: the kinds the main model call checks (history has its own check)', () => {
    expect(mainKindsOf(undefined)).toEqual(['style', 'grammar', 'pacing']);
    expect(mainKindsOf(['history', 'grammar'])).toEqual(['grammar']);
    expect(mainKindsOf(['history'])).toEqual([]);
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
  it('with some kinds off it lists only the chosen ones', () => {
    const prompt = buildRefinePrompt({ ...base, kinds: ['grammar'] });
    expect(prompt.userText).toContain('Controlla SOLO: grammar');
    expect(prompt.userText).toMatch(/Non proporre suggerimenti style né pacing/);
  });
  it('with all three main kinds the prompt is unchanged', () => {
    expect(buildRefinePrompt({ ...base, kinds: ['style', 'grammar', 'pacing'] })).toEqual(
      buildRefinePrompt(base),
    );
  });
});

describe('normalizeSuggestions drops the kinds turned off', () => {
  it('a kind that is off yields no suggestion, even if the model sends one', () => {
    const result = normalizeSuggestions(
      out([
        { kind: 'style', original: 'posò lentamente', proposals: ['posò'], rationale: 'r' },
        { kind: 'pacing', original: 'uscì fuori', proposals: ['uscì'], rationale: 'r' },
      ]),
      TEXT,
      textHash(TEXT),
      'req',
      { kinds: ['pacing'] },
    );
    expect(result.suggestions.map((s) => s.kind)).toEqual(['pacing']);
    expect(result.droppedItems.map((d) => [d.original, d.reason])).toEqual([
      ['posò lentamente', 'kind-off'],
    ]);
  });
});

describe('pendingToReplace keeps the kinds turned off', () => {
  const HASH = textHash(TEXT);
  const pending = (id: string, kind: string, from = 0, to = 5, hash = HASH) => ({
    id,
    kind,
    span: { from, to },
    textHash: hash,
  });

  it('a grammar-only refine replaces grammar pendings, keeps undecided style and pacing', () => {
    expect(
      pendingToReplace(
        [pending('g', 'grammar'), pending('s', 'style'), pending('p', 'pacing')],
        HASH,
        undefined,
        ['grammar'],
      ),
    ).toEqual(['g']);
  });

  it('still drops any pending left on an older text, whatever its kind', () => {
    expect(
      pendingToReplace([pending('old', 'style', 0, 5, 'v1-old')], HASH, undefined, ['grammar']),
    ).toEqual(['old']);
  });

  it('with a range too: only the chosen kinds touching it', () => {
    expect(
      pendingToReplace(
        [
          pending('g-in', 'grammar', 0, 5),
          pending('s-in', 'style', 0, 5),
          pending('g-out', 'grammar', 40, 45),
        ],
        HASH,
        { from: 0, to: 10 },
        ['grammar'],
      ),
    ).toEqual(['g-in']);
  });
});
