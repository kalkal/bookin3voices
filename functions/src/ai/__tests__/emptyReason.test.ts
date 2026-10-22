// A refine that ends with no suggestions must say why (the owner saw «nothing
// happens»: logs showed unsafe:1 kept:0). The reason is a code, never text.

import { emptyReasonOf, normalizeSuggestions } from '../normalizeSuggestions';
import type { ModelOutput } from '../refineTypes';
import { rejectionKey } from '../rejections';
import { textHash } from '../textHash';

const TEXT =
  "L'uomo osservò L'uomo osserva Allora sto cercando di dettare. Elena posò lentamente la tazza.";
const run = (suggestions: ModelOutput['suggestions'], rejected: string[] = []) =>
  normalizeSuggestions({ suggestions }, TEXT, textHash(TEXT), 'r', { rejected: new Set(rejected) });

describe('emptyReasonOf', () => {
  it('suggestions kept: no reason', () => {
    expect(
      emptyReasonOf(
        run([{ kind: 'style', original: 'posò lentamente', proposals: ['posò'], rationale: 'r' }]),
      ),
    ).toBeUndefined();
  });

  it('nothing proposed: the text is already fine', () => {
    expect(emptyReasonOf(run([]))).toBe('nothing-to-fix');
  });

  it('everything dropped by the guard: unsafe-dropped', () => {
    expect(
      emptyReasonOf(
        run([
          {
            kind: 'grammar',
            original: "L'uomo osservò L'uomo osserva Allora sto cercando di dettare.",
            proposals: ["L'uomo osservò."],
            rationale: 'r',
          },
        ]),
      ),
    ).toBe('unsafe-dropped');
  });

  it('everything already rejected: already-rejected', () => {
    expect(
      emptyReasonOf(
        run(
          [{ kind: 'style', original: 'posò lentamente', proposals: ['posò'], rationale: 'r' }],
          [rejectionKey('posò lentamente', 'posò')],
        ),
      ),
    ).toBe('already-rejected');
  });

  it('only unusable model answers (original not in the text): nothing-usable', () => {
    expect(
      emptyReasonOf(
        run([{ kind: 'style', original: 'non esiste', proposals: ['x'], rationale: 'r' }]),
      ),
    ).toBe('nothing-usable');
  });
});
