// Difese meccaniche del contratto: scarti, gerarchia, tetto, ordinamento.

import { normalizeSuggestions, MAX_SUGGESTIONS } from '../normalizeSuggestions';
import { suggestionSchema, type ModelOutput } from '../refineTypes';
import { textHash } from '../textHash';

const TEXT = 'Elena posò lentamente la tazza. Poi uscì fuori e chiuse la porta. Fine della scena.';
const HASH = textHash(TEXT);

function output(suggestions: ModelOutput['suggestions']): ModelOutput {
  return { suggestions };
}

const STYLE_BASE = { kind: 'style' as const, rationale: 'motivo' };

describe('normalizeSuggestions', () => {
  it('localizza gli original e produce span coerenti', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'posò lentamente', proposals: ['posò'] },
        { ...STYLE_BASE, kind: 'pacing', original: 'uscì fuori', proposals: ['uscì'] },
      ]),
      TEXT,
      HASH,
      'req-1',
    );
    expect(discarded).toBe(0);
    expect(suggestions).toHaveLength(2);
    const first = suggestions[0];
    expect(first?.span).toEqual({ from: 6, to: 21 });
    expect(TEXT.slice(first?.span.from, first?.span.to)).toBe('posò lentamente');
    expect(first?.state).toBe('pending');
    expect(first?.textHash).toBe(HASH);
    // in ordine di testo, id derivati dal requestId
    expect(suggestions.map((s) => s.id)).toEqual(['req-1-1', 'req-1-2']);
    for (const sug of suggestions) expect(suggestionSchema.parse(sug)).toBeTruthy();
  });

  it('scarta original assenti o ambigui (mai applicazioni cieche)', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'non esiste nel testo', proposals: ['x'] },
        { ...STYLE_BASE, original: 'la', proposals: ['x'] }, // «la» compare più volte
        { ...STYLE_BASE, original: 'uscì fuori', proposals: ['uscì'] },
      ]),
      TEXT,
      HASH,
      'req-2',
    );
    expect(discarded).toBe(2);
    expect(suggestions.map((s) => s.original)).toEqual(['uscì fuori']);
  });

  it('grammar: si tiene solo la prima proposta (gerarchia)', () => {
    const { suggestions } = normalizeSuggestions(
      output([
        {
          kind: 'grammar',
          rationale: 'motivo',
          original: 'Fine della scena.',
          proposals: ['Fine della scena!', 'Fine!'],
        },
      ]),
      TEXT,
      HASH,
      'req-3',
    );
    expect(suggestions[0]?.proposals).toEqual(['Fine della scena.'.replace('.', '!')]);
  });

  it('proposte vuote o identiche all’original vengono rimosse; senza proposte → scarto', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'uscì fuori', proposals: ['  ', 'uscì fuori', 'uscì'] },
        { ...STYLE_BASE, original: 'posò lentamente', proposals: ['posò lentamente'] },
      ]),
      TEXT,
      HASH,
      'req-4',
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.proposals).toEqual(['uscì']);
    expect(discarded).toBe(1);
  });

  it('span sovrapposti: vince il primo in ordine di testo', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      output([
        { ...STYLE_BASE, original: 'lentamente la tazza', proposals: ['la tazza'] },
        { ...STYLE_BASE, original: 'posò lentamente', proposals: ['posò'] },
      ]),
      TEXT,
      HASH,
      'req-5',
    );
    expect(suggestions.map((s) => s.original)).toEqual(['posò lentamente']);
    expect(discarded).toBe(1);
  });

  it('tetto assoluto: mai più di MAX_SUGGESTIONS', () => {
    const words = Array.from({ length: 40 }, (_, i) => `parola${String(i).padStart(2, '0')}`);
    const longText = words.join(' ');
    const { suggestions, discarded } = normalizeSuggestions(
      output(words.map((word) => ({ ...STYLE_BASE, original: word, proposals: ['x'] }))),
      longText,
      textHash(longText),
      'req-6',
    );
    expect(suggestions).toHaveLength(MAX_SUGGESTIONS);
    expect(discarded).toBe(40 - MAX_SUGGESTIONS);
  });
});

describe('normalizeSuggestions: whitespace tolerance', () => {
  it('finds a span the model copied with stray leading/trailing whitespace', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      { suggestions: [{ ...STYLE_BASE, original: '\nposò lentamente\t', proposals: ['posò'] }] },
      TEXT,
      HASH,
      'req-ws',
    );
    expect(discarded).toBe(0);
    expect(suggestions[0]?.original).toBe('posò lentamente');
    expect(TEXT.slice(suggestions[0]?.span.from, suggestions[0]?.span.to)).toBe('posò lentamente');
  });

  it('still discards a span that is absent even after trimming', () => {
    const { suggestions, discarded } = normalizeSuggestions(
      { suggestions: [{ ...STYLE_BASE, original: '  non c’è  ', proposals: ['x'] }] },
      TEXT,
      HASH,
      'req-ws2',
    );
    expect(suggestions).toHaveLength(0);
    expect(discarded).toBe(1);
  });
});
