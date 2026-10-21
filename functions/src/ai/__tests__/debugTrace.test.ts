// Dev-only debug trace of a refinement: the request context, the raw model
// suggestions, the normalized ones and every dropped one with its reason.

import { buildRefineDebugTrace, debugTraceEnabled, TRACE_SNIPPET_CHARS } from '../debugTrace';
import { normalizeSuggestions } from '../normalizeSuggestions';
import type { ModelOutput } from '../refineTypes';
import { textHash } from '../textHash';

const TEXT = 'Elena posò lentamente la tazza. Poi uscì fuori e chiuse la porta. Fine della scena.';
const HASH = textHash(TEXT);
const STYLE = { kind: 'style' as const, rationale: 'motivo' };

describe('normalizeSuggestions: dropped items', () => {
  it('lists each dropped suggestion with a stable reason', () => {
    const { suggestions, discarded, droppedItems } = normalizeSuggestions(
      {
        suggestions: [
          { ...STYLE, original: 'posò lentamente', proposals: ['posò'] },
          { ...STYLE, original: 'non esiste', proposals: ['x'] },
          { ...STYLE, original: 'la', proposals: ['una'] },
          { ...STYLE, original: 'uscì fuori', proposals: ['uscì fuori', ' '] },
          { ...STYLE, kind: 'pacing', original: 'lentamente la tazza', proposals: ['la tazza'] },
        ],
      },
      TEXT,
      HASH,
      'req-1',
    );
    expect(suggestions.map((s) => s.original)).toEqual(['posò lentamente']);
    expect(droppedItems.map((d) => [d.original, d.reason])).toEqual([
      ['non esiste', 'original-not-found'],
      ['la', 'original-ambiguous'],
      ['uscì fuori', 'no-proposals'],
      ['lentamente la tazza', 'overlap'],
    ]);
    expect(droppedItems).toHaveLength(discarded);
  });

  it('marks the suggestions cut by the density cap', () => {
    const words = Array.from({ length: 40 }, (_, i) => `p${i}q`).join(' ');
    const many: ModelOutput['suggestions'] = Array.from({ length: 5 }, (_, i) => ({
      ...STYLE,
      original: `p${i * 2}q`,
      proposals: [`p${i}`],
    }));
    const { droppedItems, densityCut } = normalizeSuggestions(
      { suggestions: many },
      words,
      textHash(words),
      'req-2',
    );
    expect(densityCut).toBe(2);
    expect(droppedItems.filter((d) => d.reason === 'density-cap')).toHaveLength(2);
  });
});

describe('buildRefineDebugTrace', () => {
  const raw: ModelOutput['suggestions'] = [
    { ...STYLE, original: 'posò lentamente', proposals: ['posò'] },
    { ...STYLE, original: 'non esiste', proposals: ['x'] },
    { ...STYLE, original: 'chiuse la porta', proposals: ['chiuse'] },
  ];
  const history: ModelOutput['suggestions'] = [
    {
      kind: 'history',
      aspect: 'anachronism',
      original: 'chiuse la porta',
      proposals: ['sprangò la porta'],
      rationale: 'epoca',
    },
  ];
  const merged = [raw[0], raw[1], history[0]] as ModelOutput['suggestions'];
  const normalized = normalizeSuggestions({ suggestions: merged }, TEXT, HASH, 'req-3');

  const trace = buildRefineDebugTrace({
    promptVersion: 3,
    model: 'amazon.nova-pro-v1:0',
    book: { genre: 'romanzo', language: 'it', synopsis: 'Una sinossi.', styleProfileId: null },
    chapter: { title: 'Uno', outline: { summary: 's', beats: ['a', 'b'] } },
    text: TEXT,
    textHash: HASH,
    raw,
    parseDropped: 1,
    history: { suggestions: history, calls: 2, periodLabel: 'Ottocento', dropped: 0 },
    merged,
    normalized,
  });

  it('carries prompt version, model and the context sent', () => {
    expect(trace.promptVersion).toBe(3);
    expect(trace.model).toBe('amazon.nova-pro-v1:0');
    expect(trace.context).toEqual({
      style: 'suspense',
      language: 'it',
      genre: 'romanzo',
      period: 'Ottocento',
      synopsisChars: 12,
      outlineBeats: 2,
      chapterTitle: 'Uno',
      textChars: TEXT.length,
      textWords: 15,
      textHash: HASH,
      textSnippet: TEXT,
      densityCap: 3,
    });
  });

  it('keeps raw and normalized suggestions apart', () => {
    expect(trace.raw.map((s) => s.original)).toEqual([
      'posò lentamente',
      'non esiste',
      'chiuse la porta',
    ]);
    expect(trace.history?.raw.map((s) => s.original)).toEqual(['chiuse la porta']);
    expect(trace.normalized.map((s) => [s.kind, s.original])).toEqual([
      ['style', 'posò lentamente'],
      ['history', 'chiuse la porta'],
    ]);
  });

  it('lists every dropped suggestion, merge losses included, with its reason', () => {
    expect(trace.dropped.map((d) => [d.original, d.reason])).toEqual([
      ['chiuse la porta', 'overlaps-history-check'],
      ['non esiste', 'original-not-found'],
    ]);
    expect(trace.parseDropped).toBe(1);
  });

  it('caps the text snippet', () => {
    const long = 'a'.repeat(TRACE_SNIPPET_CHARS + 50);
    const t = buildRefineDebugTrace({
      promptVersion: 3,
      model: 'm',
      book: { genre: '', language: 'it', synopsis: '', styleProfileId: 'thriller' },
      chapter: { title: '', outline: null },
      text: long,
      textHash: textHash(long),
      raw: [],
      parseDropped: 0,
      history: null,
      merged: [],
      normalized: normalizeSuggestions({ suggestions: [] }, long, textHash(long), 'r'),
    });
    expect(t.context.textSnippet).toHaveLength(TRACE_SNIPPET_CHARS);
    expect(t.context.style).toBe('thriller');
    expect(t.history).toBeNull();
  });
});

describe('debugTraceEnabled', () => {
  it('is on only with DEBUG_TRACE=1 or in the emulator', () => {
    expect(debugTraceEnabled({})).toBe(false);
    expect(debugTraceEnabled({ DEBUG_TRACE: '0' })).toBe(false);
    expect(debugTraceEnabled({ DEBUG_TRACE: 'true' })).toBe(false);
    expect(debugTraceEnabled({ DEBUG_TRACE: '1' })).toBe(true);
    expect(debugTraceEnabled({ FUNCTIONS_EMULATOR: 'true' })).toBe(true);
  });
});
