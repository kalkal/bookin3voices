import { acceptNoticeFor } from '../useChapterReview';

describe('acceptNoticeFor', () => {
  it('unsafe proposal: says it would delete text', () => {
    expect(acceptNoticeFor('unsafe-proposal')).toBe(
      'Questo suggerimento cancellerebbe parte del testo: non l’ho applicato. Il testo è intatto.',
    );
  });

  it.each(['original-mismatch', 'span-out-of-range'] as const)(
    '%s: says it no longer matches the text',
    (reason) => {
      expect(acceptNoticeFor(reason)).toMatch(/non corrisponde più al testo/);
    },
  );

  it.each(['unknown-suggestion', 'not-pending', 'invalid-proposal'] as const)(
    '%s: no claim about the text (it was not about the text)',
    (reason) => {
      expect(acceptNoticeFor(reason)).toBe('');
    },
  );
});
