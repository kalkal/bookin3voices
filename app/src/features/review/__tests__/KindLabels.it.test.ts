import { KIND_LABELS, SUGGESTION_KINDS } from '../types';

describe('KIND_LABELS (Italian, the default)', () => {
  it('names all four categories, history included', () => {
    expect(SUGGESTION_KINDS.map((kind) => KIND_LABELS[kind])).toEqual([
      'Stile',
      'Grammatica',
      'Ritmo',
      'Storico',
    ]);
  });
});
