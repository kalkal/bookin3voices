import { suggestionSchema } from '../types';

const BASE = {
  id: 'sug-1',
  kind: 'style' as const,
  span: { from: 5, to: 20 },
  original: 'posò lentamente',
  proposals: ['posò', 'posò, piano,'],
  rationale: 'L’avverbio smorza il gesto.',
  state: 'pending' as const,
  textHash: 'v1-0000000000000000',
};

describe('suggestionSchema (contratto condiviso con la callable refineChapter)', () => {
  it('accetta un suggerimento di stile con varianti', () => {
    expect(() => suggestionSchema.parse(BASE)).not.toThrow();
  });

  it('rifiuta più di 3 varianti', () => {
    expect(() => suggestionSchema.parse({ ...BASE, proposals: ['a', 'b', 'c', 'd'] })).toThrow();
  });

  it('grammatica vuole UNA sola proposta; il ritmo ha varianti come lo stile (gerarchia delle proposte)', () => {
    const grammar = { ...BASE, kind: 'grammar' as const, proposals: ['una', 'due'] };
    expect(() => suggestionSchema.parse(grammar)).toThrow();
    expect(() => suggestionSchema.parse({ ...grammar, proposals: ['una'] })).not.toThrow();
    expect(() =>
      suggestionSchema.parse({ ...BASE, kind: 'pacing' as const, proposals: ['a', 'b'] }),
    ).not.toThrow();
  });

  it('rifiuta proposte vuote e span vuoti o rovesciati', () => {
    expect(() => suggestionSchema.parse({ ...BASE, proposals: [''] })).toThrow();
    expect(() =>
      suggestionSchema.parse({ ...BASE, span: { from: 5, to: 5 }, original: '' }),
    ).toThrow();
    expect(() => suggestionSchema.parse({ ...BASE, span: { from: 20, to: 5 } })).toThrow();
  });

  it('original deve essere lungo esattamente quanto lo span', () => {
    expect(() => suggestionSchema.parse({ ...BASE, original: 'posò' })).toThrow();
  });

  it('acceptedProposal deve puntare a una proposta esistente', () => {
    expect(() => suggestionSchema.parse({ ...BASE, acceptedProposal: 1 })).not.toThrow();
    expect(() => suggestionSchema.parse({ ...BASE, acceptedProposal: 2 })).toThrow();
  });
});
