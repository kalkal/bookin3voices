import { FirebaseError } from 'firebase/app';

import { isExampleSuggestion } from '../../review/example';
import { checkProposal } from '../../review/proposalGuard';
import { rejectionKey } from '../../review/rejections';
import { textHash } from '../../review/textHash';
import { refineResultSchema } from '../../review/types';
import type { RefineRequest, SuggestionsProvider } from '../../review/types';
import {
  ExampleFallbackSuggestionsProvider,
  exampleRefineResult,
  isAiUnavailablePlaceholder,
} from '../exampleRefine';
import { SAMPLE_BOOK_CONTENT } from '../sampleBookContent';
import { SAMPLE_BOOK_ID } from '../sampleBook';

const [FIRST] = SAMPLE_BOOK_CONTENT.chapters;

function request(chapterId: string, text: string, extra: Partial<RefineRequest> = {}) {
  return {
    bookId: SAMPLE_BOOK_ID,
    chapterId,
    text,
    textHash: textHash(text),
    requestId: 'ref-1',
    ...extra,
  };
}

const failing = (error: unknown): SuggestionsProvider => ({
  refine: async () => {
    throw error;
  },
});

beforeEach(() => jest.spyOn(console, 'info').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('exampleRefineResult', () => {
  it.each(SAMPLE_BOOK_CONTENT.chapters.map((c) => [c.id, c] as const))(
    '%s: every example passes the schema, its span matches the text, its proposals pass the guard',
    (_id, chapter) => {
      const result = exampleRefineResult(SAMPLE_BOOK_ID, chapter.id, chapter.text);
      expect(result).toBeDefined();
      const parsed = refineResultSchema.parse(result);
      expect(parsed.textHash).toBe(textHash(chapter.text));
      // none lost: each original is in the text exactly once
      expect(parsed.suggestions).toHaveLength(chapter.examples.length);
      for (const suggestion of parsed.suggestions) {
        expect(isExampleSuggestion(suggestion)).toBe(true);
        expect(chapter.text.slice(suggestion.span.from, suggestion.span.to)).toBe(
          suggestion.original,
        );
        for (const proposal of suggestion.proposals) {
          expect(checkProposal(suggestion.kind, suggestion.original, proposal)).toEqual({
            ok: true,
          });
        }
      }
    },
  );

  it('the book covers style, grammar, pacing and both history aspects', () => {
    const all = SAMPLE_BOOK_CONTENT.chapters.flatMap((c) => c.examples);
    expect(new Set(all.map((e) => e.kind))).toEqual(
      new Set(['style', 'grammar', 'pacing', 'history']),
    );
    expect(new Set(all.filter((e) => e.kind === 'history').map((e) => e.aspect))).toEqual(
      new Set(['period', 'anachronism']),
    );
  });

  it('is undefined for any other book or chapter', () => {
    expect(exampleRefineResult('another-book', FIRST.id, FIRST.text)).toBeUndefined();
    expect(exampleRefineResult(SAMPLE_BOOK_ID, 'sample-9', FIRST.text)).toBeUndefined();
  });

  it('serves only the examples whose text is still there, and none on a rewritten chapter', () => {
    const accepted = FIRST.text.replace('a few coins', 'a few soldi');
    const result = exampleRefineResult(SAMPLE_BOOK_ID, FIRST.id, accepted);
    expect(result?.suggestions.map((s) => s.original)).not.toContain('a few coins');
    expect(result?.suggestions).toHaveLength(FIRST.examples.length - 1);
    expect(result?.textHash).toBe(textHash(accepted));

    expect(exampleRefineResult(SAMPLE_BOOK_ID, FIRST.id, 'A brand new text.')).toBeUndefined();
  });

  it('a selection gets only the examples inside it; rejected proposals never come back', () => {
    const from = FIRST.text.indexOf('a few coins');
    const inRange = exampleRefineResult(SAMPLE_BOOK_ID, FIRST.id, FIRST.text, {
      range: { from, to: from + 40 },
    });
    expect(inRange?.suggestions.map((s) => s.original)).toEqual(['a few coins']);

    const rejected = [rejectionKey('a few coins', 'a few silver soldi')];
    const result = exampleRefineResult(SAMPLE_BOOK_ID, FIRST.id, FIRST.text, { rejected });
    const coins = result?.suggestions.find((s) => s.original === 'a few coins');
    expect(coins?.proposals).toEqual(['a few soldi']);
  });
});

describe('isAiUnavailablePlaceholder', () => {
  it('is true for the callable codes of an AI that could not answer, false otherwise', () => {
    expect(isAiUnavailablePlaceholder(new FirebaseError('functions/unavailable', 'x'))).toBe(true);
    expect(isAiUnavailablePlaceholder(new FirebaseError('functions/internal', 'x'))).toBe(true);
    expect(isAiUnavailablePlaceholder(new FirebaseError('functions/unauthenticated', 'x'))).toBe(
      false,
    );
    expect(isAiUnavailablePlaceholder(new Error('boom'))).toBe(false);
    expect(isAiUnavailablePlaceholder(undefined)).toBe(false);
  });
});

describe('ExampleFallbackSuggestionsProvider', () => {
  const unavailable = new FirebaseError('functions/unavailable', 'down');

  it('the live AI always goes first', async () => {
    const live = { textHash: textHash(FIRST.text), suggestions: [] };
    const provider = new ExampleFallbackSuggestionsProvider({
      inner: { refine: async () => live },
      isAiUnavailable: () => true,
    });
    await expect(provider.refine(request(FIRST.id, FIRST.text))).resolves.toBe(live);
  });

  it('AI unavailable on the sample book: the labelled examples stand in', async () => {
    const provider = new ExampleFallbackSuggestionsProvider({
      inner: failing(unavailable),
      isAiUnavailable: isAiUnavailablePlaceholder,
    });
    const result = await provider.refine(request(FIRST.id, FIRST.text));
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions.every(isExampleSuggestion)).toBe(true);
  });

  it('any other failure, or another book, is the live error as is', async () => {
    const denied = new FirebaseError('functions/unauthenticated', 'expired');
    const strict = new ExampleFallbackSuggestionsProvider({
      inner: failing(denied),
      isAiUnavailable: isAiUnavailablePlaceholder,
    });
    await expect(strict.refine(request(FIRST.id, FIRST.text))).rejects.toBe(denied);

    const otherBook = new ExampleFallbackSuggestionsProvider({
      inner: failing(unavailable),
      isAiUnavailable: isAiUnavailablePlaceholder,
    });
    await expect(
      otherBook.refine({ ...request(FIRST.id, FIRST.text), bookId: 'my-novel' }),
    ).rejects.toBe(unavailable);
  });
});
