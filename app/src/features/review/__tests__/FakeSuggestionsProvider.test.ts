import { FakeSuggestionsProvider } from '../FakeSuggestionsProvider';
import { textHash } from '../textHash';
import { suggestionSchema } from '../types';
import type { RefineResult } from '../types';

// passage in the spirit of the golden set (adverbs, filter verb, dictation
// slips): the fake provider must find all three categories in it
const BRANO =
  'Irene posò lentamente il bicchiere nel lavello. aprì il rubinetto e mentre ' +
  'beveva sentì che qualcosa non andava. Prese un altra tazza dallo scolapiatti.';

async function refine(text: string): Promise<RefineResult> {
  const provider = new FakeSuggestionsProvider();
  return provider.refine({
    bookId: 'libro',
    chapterId: 'cap-1',
    text,
    textHash: textHash(text),
    requestId: 'req-1',
  });
}

describe('FakeSuggestionsProvider (behind the refineChapter callable interface)', () => {
  it('every suggestion respects the shared schema and matches the text', async () => {
    const result = await refine(BRANO);
    expect(result.textHash).toBe(textHash(BRANO));
    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of result.suggestions) {
      expect(() => suggestionSchema.parse(suggestion)).not.toThrow();
      expect(BRANO.slice(suggestion.span.from, suggestion.span.to)).toBe(suggestion.original);
      expect(suggestion.state).toBe('pending');
      expect(suggestion.textHash).toBe(result.textHash);
    }
  });

  it('-mente adverb → style with 3 variants (hierarchy)', async () => {
    const result = await refine(BRANO);
    const adverb = result.suggestions.find((s) => s.original === 'posò lentamente');
    expect(adverb).toBeDefined();
    expect(adverb).toMatchObject({ kind: 'style' });
    expect(adverb?.proposals).toEqual(['posò', 'posò, piano,', 'posò senza fretta']);
  });

  it('filter verb → style, the perception stays without the frame', async () => {
    const result = await refine(BRANO);
    const filter = result.suggestions.find((s) => s.original.startsWith('sentì che'));
    expect(filter).toMatchObject({ kind: 'style', proposals: ['qualcosa'] });
  });

  it('missing elision → grammar with ONE proposal', async () => {
    const result = await refine(BRANO);
    const elision = result.suggestions.find((s) => s.original === 'un altra');
    expect(elision).toMatchObject({ kind: 'grammar', proposals: ["un'altra"] });
  });

  it('lowercase after a period → grammar with the capital', async () => {
    const result = await refine(BRANO);
    const lower = result.suggestions.find(
      (s) => s.kind === 'grammar' && s.original === 'a' && s.proposals[0] === 'A',
    );
    expect(lower).toBeDefined();
    // it is exactly the 'a' of 'aprì'
    expect(BRANO.slice(lower!.span.from)).toMatch(/^aprì/);
  });

  it('very long sentence → pacing with a cautious split', async () => {
    const lunga =
      'Scese il primo gradino e poi il secondo e il legno scricchiolava come sempre ' +
      'e lei continuava a dirsi che era la caldaia che era soltanto la caldaia che domani ' +
      'avrebbe chiamato il tecnico e sarebbe finita lì e invece i colpi continuavano ' +
      'a salire dal buio della cantina come se qualcuno chiedesse di entrare.';
    const result = await refine(lunga);
    const pacing = result.suggestions.find((s) => s.kind === 'pacing');
    expect(pacing).toBeDefined();
    expect(pacing?.proposals).toHaveLength(1);
    expect(pacing?.original).toMatch(/^ e \p{Ll}/u);
    expect(pacing?.proposals[0]).toMatch(/^\. \p{Lu}/u);
  });

  it('spans in the same batch never overlap', async () => {
    const result = await refine(BRANO);
    const sorted = [...result.suggestions].sort((a, b) => a.span.from - b.span.from);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].span.from).toBeGreaterThanOrEqual(sorted[i - 1].span.to);
    }
  });

  it('limited density as in the golden set: never more than 8 suggestions', async () => {
    const pioggia = Array.from(
      { length: 20 },
      (_, i) => `Paolo posò lentamente il libro numero ${i}.`,
    ).join(' ');
    const result = await refine(pioggia);
    expect(result.suggestions.length).toBeLessThanOrEqual(8);
  });

  it('text without flaws → no suggestions (no noise)', async () => {
    const result = await refine('Il molo era deserto. Nora posò la tazza.');
    expect(result.suggestions).toHaveLength(0);
  });
});
