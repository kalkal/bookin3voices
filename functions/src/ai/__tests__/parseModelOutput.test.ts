// A malformed suggestion must not make us lose the good ones (seen live with
// Nova Lite: one element with `proposals: []` invalidated the whole response).

import { parseModelOutput } from '../refineTypes';

const GOOD = {
  original: 'disse minacciosamente',
  kind: 'style',
  rationale: "L'avverbio spiega la minaccia.",
  proposals: ['disse'],
};

describe('parseModelOutput', () => {
  it('accepts a valid response with no discards', () => {
    const parsed = parseModelOutput({ suggestions: [GOOD] });
    expect(parsed).toEqual({ output: { suggestions: [GOOD] }, dropped: 0 });
  });

  it('accepts a valid response with no suggestions', () => {
    expect(parseModelOutput({ suggestions: [] })).toEqual({
      output: { suggestions: [] },
      dropped: 0,
    });
  });

  it('keeps the good suggestions and counts the malformed ones', () => {
    const parsed = parseModelOutput({
      suggestions: [GOOD, { ...GOOD, proposals: [] }, { ...GOOD, kind: 'tone' }, 'non un oggetto'],
    });
    expect(parsed?.output.suggestions).toEqual([GOOD]);
    expect(parsed?.dropped).toBe(3);
  });

  it('returns null if no suggestion is valid, so a retry happens', () => {
    expect(parseModelOutput({ suggestions: [{ ...GOOD, proposals: [] }] })).toBeNull();
  });

  it('returns null if the suggestions array is missing', () => {
    expect(parseModelOutput({ text: 'ciao' })).toBeNull();
    expect(parseModelOutput(null)).toBeNull();
    expect(parseModelOutput('testo')).toBeNull();
  });

  it('respects the cap of 40 suggestions', () => {
    const many = Array.from({ length: 45 }, () => GOOD);
    const parsed = parseModelOutput({ suggestions: [...many, { ...GOOD, proposals: [] }] });
    expect(parsed?.output.suggestions).toHaveLength(40);
    expect(parsed?.dropped).toBe(6);
  });
});
