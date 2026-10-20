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

describe('suggestionSchema (contract shared with the refineChapter callable)', () => {
  it('accepts a style suggestion with variants', () => {
    expect(() => suggestionSchema.parse(BASE)).not.toThrow();
  });

  it('rejects more than 3 variants', () => {
    expect(() => suggestionSchema.parse({ ...BASE, proposals: ['a', 'b', 'c', 'd'] })).toThrow();
  });

  it('grammar takes a SINGLE proposal; pacing has variants like style (proposal hierarchy)', () => {
    const grammar = { ...BASE, kind: 'grammar' as const, proposals: ['una', 'due'] };
    expect(() => suggestionSchema.parse(grammar)).toThrow();
    expect(() => suggestionSchema.parse({ ...grammar, proposals: ['una'] })).not.toThrow();
    expect(() =>
      suggestionSchema.parse({ ...BASE, kind: 'pacing' as const, proposals: ['a', 'b'] }),
    ).not.toThrow();
  });

  it('history carries its aspect (period tip or anachronism) and variants like style', () => {
    const history = {
      ...BASE,
      kind: 'history' as const,
      aspect: 'anachronism' as const,
      original: 'il televisore',
      span: { from: 5, to: 18 },
      proposals: ['la radio', 'il grammofono'],
      rationale: 'Da verificare: nel 1943 la televisione in casa non c’era ancora.',
    };
    expect(() => suggestionSchema.parse(history)).not.toThrow();
    expect(() => suggestionSchema.parse({ ...history, aspect: 'period' })).not.toThrow();
    // the aspect belongs to history only, and history always has one
    expect(() => suggestionSchema.parse({ ...history, aspect: undefined })).toThrow();
    expect(() => suggestionSchema.parse({ ...BASE, aspect: 'period' })).toThrow();
  });

  it('rejects empty proposals and empty or reversed spans', () => {
    expect(() => suggestionSchema.parse({ ...BASE, proposals: [''] })).toThrow();
    expect(() =>
      suggestionSchema.parse({ ...BASE, span: { from: 5, to: 5 }, original: '' }),
    ).toThrow();
    expect(() => suggestionSchema.parse({ ...BASE, span: { from: 20, to: 5 } })).toThrow();
  });

  it('original must be exactly as long as the span', () => {
    expect(() => suggestionSchema.parse({ ...BASE, original: 'posò' })).toThrow();
  });

  it('acceptedProposal must point to an existing proposal', () => {
    expect(() => suggestionSchema.parse({ ...BASE, acceptedProposal: 1 })).not.toThrow();
    expect(() => suggestionSchema.parse({ ...BASE, acceptedProposal: 2 })).toThrow();
  });
});
