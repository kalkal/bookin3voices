import { FakeSuggestionsProvider } from '../FakeSuggestionsProvider';
import { textHash } from '../textHash';
import { suggestionSchema } from '../types';
import type { RefineResult } from '../types';

// passage in the spirit of the golden set (adverbs, filter verb, dictation
// slips): the fake provider must find all three categories in it
const BRANO =
  'Nora posò lentamente il telefono sul davanzale. aprì la finestra e mentre ' +
  'guardava la macchia sentì che qualcosa non andava. Prese un altra tazza dalla credenza.';

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
      'Salì il primo gradino della scala e poi il secondo e il metallo scricchiolava ' +
      'e lei continuava a dirsi che era il tubo del bagno di sopra che era soltanto il tubo ' +
      'che il tecnico sarebbe arrivato e sarebbe finita lì e invece la macchia continuava ' +
      'ad allargarsi sul soffitto come se qualcuno la spingesse dall’altra parte.';
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
    const result = await refine('Il cortile era deserto. Nora posò la tazza.');
    expect(result.suggestions).toHaveLength(0);
  });
});

describe('history: period tips and anachronism warnings, as hints to check', () => {
  // invented scene, no names: wartime Naples plus a television that does not belong there
  const NAPOLI =
    'Napoli, 1943. La strada era deserta sotto la luna. ' +
    'Nel basso, la madre accese il televisore per sentire le notizie.';

  it('a chapter set in «Napoli, 1943» gets a period tip AND an anachronism warning', async () => {
    const result = await refine(NAPOLI);
    const history = result.suggestions.filter((s) => s.kind === 'history');
    expect(history.map((s) => s.aspect)).toEqual(['period', 'anachronism']);

    const [tip, anachronism] = history;
    expect(tip?.original).toBe('Napoli, 1943.');
    expect(tip?.proposals[0]).toMatch(/^Napoli, 1943\. /);
    expect(tip?.rationale).toMatch(/^Da verificare/);
    expect(tip?.rationale).toMatch(/sirene|tessere annonarie|oscuramento/);

    expect(anachronism?.original).toBe('il televisore');
    expect(anachronism?.proposals).toContain('la radio');
    expect(anachronism?.rationale).toMatch(/^Da verificare/);
    expect(anachronism?.rationale).toContain('1943');

    for (const suggestion of history) {
      expect(() => suggestionSchema.parse(suggestion)).not.toThrow();
      expect(NAPOLI.slice(suggestion.span.from, suggestion.span.to)).toBe(suggestion.original);
    }
  });

  it('a chapter with no recognisable period gets no history suggestion at all', async () => {
    const result = await refine(
      'La strada era deserta sotto la luna. Nel basso, la madre accese il televisore.',
    );
    expect(result.suggestions.filter((s) => s.kind === 'history')).toEqual([]);
  });

  it('a recent year is not a historical period: no history suggestion', async () => {
    const result = await refine('Era il 2019. La madre accese il televisore.');
    expect(result.suggestions.filter((s) => s.kind === 'history')).toEqual([]);
  });

  it('an object already in use in that period is not flagged', async () => {
    const result = await refine('Roma, 1962. La madre accese il televisore.');
    const history = result.suggestions.filter((s) => s.kind === 'history');
    expect(history.map((s) => s.aspect)).toEqual(['period']);
  });

  it('matches whole words only', async () => {
    const result = await refine('Napoli, 1943. Nessuno sapeva cosa fosse il televisorino.');
    const history = result.suggestions.filter((s) => s.kind === 'history');
    expect(history.map((s) => s.aspect)).toEqual(['period']);
  });
});
