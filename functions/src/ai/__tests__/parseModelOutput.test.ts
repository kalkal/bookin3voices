// Un suggerimento malformato non deve far perdere quelli buoni (visto dal vivo
// con Nova Lite: un elemento con `proposals: []` invalidava tutta la risposta).

import { parseModelOutput } from '../refineTypes';

const GOOD = {
  original: 'disse minacciosamente',
  kind: 'style',
  rationale: "L'avverbio spiega la minaccia.",
  proposals: ['disse'],
};

describe('parseModelOutput', () => {
  it('accetta una risposta valida senza scarti', () => {
    const parsed = parseModelOutput({ suggestions: [GOOD] });
    expect(parsed).toEqual({ output: { suggestions: [GOOD] }, dropped: 0 });
  });

  it('accetta una risposta valida senza suggerimenti', () => {
    expect(parseModelOutput({ suggestions: [] })).toEqual({
      output: { suggestions: [] },
      dropped: 0,
    });
  });

  it('tiene i suggerimenti buoni e conta quelli malformati', () => {
    const parsed = parseModelOutput({
      suggestions: [GOOD, { ...GOOD, proposals: [] }, { ...GOOD, kind: 'tone' }, 'non un oggetto'],
    });
    expect(parsed?.output.suggestions).toEqual([GOOD]);
    expect(parsed?.dropped).toBe(3);
  });

  it('ritorna null se nessun suggerimento è valido, così si ritenta', () => {
    expect(parseModelOutput({ suggestions: [{ ...GOOD, proposals: [] }] })).toBeNull();
  });

  it("ritorna null se manca l'array suggestions", () => {
    expect(parseModelOutput({ text: 'ciao' })).toBeNull();
    expect(parseModelOutput(null)).toBeNull();
    expect(parseModelOutput('testo')).toBeNull();
  });

  it('rispetta il tetto di 40 suggerimenti', () => {
    const many = Array.from({ length: 45 }, () => GOOD);
    const parsed = parseModelOutput({ suggestions: [...many, { ...GOOD, proposals: [] }] });
    expect(parsed?.output.suggestions).toHaveLength(40);
    expect(parsed?.dropped).toBe(6);
  });
});
