// The owner saw a new refinement propose again suggestions she had REJECTED on
// the same text. The app sends compact keys of the rejected (original, proposal)
// pairs; the server drops those proposals in ONE place (normalizeSuggestions).
// Reference vectors IDENTICAL to app/src/features/review/__tests__/rejections.test.ts.

import { normalizeSuggestions } from '../normalizeSuggestions';
import { refineChapterInputSchema, type ModelOutput } from '../refineTypes';
import { rejectionKey } from '../rejections';
import { textHash } from '../textHash';

const TEXT = 'Elena posò lentamente un altra tazza sul tavolo.';
const out = (suggestions: ModelOutput['suggestions']): ModelOutput => ({ suggestions });

describe('rejectionKey (shared with the app)', () => {
  it('known values', () => {
    expect(rejectionKey('un altra', "un'altra")).toBe('v1-84d280b844adf94e');
    expect(rejectionKey('posò lentamente', 'posò')).toBe('v1-e54c17fda7dab3b4');
  });
});

describe('normalizeSuggestions never re-proposes a rejected pair', () => {
  it('drops the rejected proposal, keeps the others and the other suggestions', () => {
    const result = normalizeSuggestions(
      out([
        { kind: 'grammar', original: 'un altra', proposals: ["un'altra"], rationale: 'elisione' },
        {
          kind: 'style',
          original: 'posò lentamente',
          proposals: ['posò', 'posò piano'],
          rationale: 'avverbio',
        },
      ]),
      TEXT,
      textHash(TEXT),
      'req-1',
      {
        rejected: new Set([
          rejectionKey('un altra', "un'altra"),
          rejectionKey('posò lentamente', 'posò'),
        ]),
      },
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      original: 'posò lentamente',
      proposals: ['posò piano'],
    });
    expect(result.alreadyRejected).toBe(2);
    expect(result.discarded).toBe(1);
  });

  it('the same proposal on a DIFFERENT original is still proposed', () => {
    const result = normalizeSuggestions(
      out([
        { kind: 'grammar', original: 'un altra', proposals: ["un'altra"], rationale: 'elisione' },
      ]),
      TEXT,
      textHash(TEXT),
      'req-2',
      { rejected: new Set([rejectionKey('un altra tazza', "un'altra")]) },
    );
    expect(result.suggestions).toHaveLength(1);
    expect(result.alreadyRejected).toBe(0);
  });
});

describe('refineChapter input', () => {
  const base = { bookId: 'b', chapterId: 'c', text: 't', textHash: 'v1-x', requestId: 'r1' };
  it('accepts an optional list of rejection keys, bounded', () => {
    expect(
      refineChapterInputSchema.safeParse({ ...base, rejected: ['v1-84d280b844adf94e'] }).success,
    ).toBe(true);
    expect(refineChapterInputSchema.safeParse(base).success).toBe(true);
    expect(refineChapterInputSchema.safeParse({ ...base, rejected: ['not a key'] }).success).toBe(
      false,
    );
    expect(
      refineChapterInputSchema.safeParse({
        ...base,
        rejected: Array(501).fill('v1-84d280b844adf94e'),
      }).success,
    ).toBe(false);
  });
});
