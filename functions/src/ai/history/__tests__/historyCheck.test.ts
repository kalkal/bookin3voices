import { aiError, type AiJsonRequest, type AiProvider, type AiResult } from '../../provider/types';
import { mergeWithHistory, runHistoryCheck, runHistoryCheckWithin } from '../historyCheck';

const NAPOLI =
  'Napoli, agosto 1943. Elena salì le scale. In cucina la madre aveva lasciato la ' +
  'lavatrice accesa. Qualcuno correva verso il porto.';

/** A provider that answers with the given results, one per call, and records the requests. */
function scripted(results: AiResult[]) {
  const requests: AiJsonRequest[] = [];
  const provider: AiProvider = {
    name: 'bedrock',
    modelName: 'fake-nova',
    generateJson: async (request) => {
      requests.push(request);
      return results[Math.min(requests.length - 1, results.length - 1)] as AiResult;
    },
  };
  return { provider, requests };
}

const ok = (value: unknown): AiResult => ({ ok: true, value });
const NO_PERIOD = ok({ period_named: false, quote: '', period_label: '' });
const PERIOD = ok({
  period_named: true,
  quote: 'Napoli, agosto 1943',
  period_label: 'Naples, 1943',
});

const REPORT = ok({
  period_details: [
    {
      anchor_quote: 'Qualcuno correva verso il porto.',
      category: 'objects',
      rewrite: 'Qualcuno correva verso il porto, mentre la sirena dell’allarme aereo suonava.',
      note_for_author: 'In tempo di guerra le sirene dell’allarme aereo erano frequenti.',
    },
  ],
  anachronisms: [
    {
      trigger_quote: 'lavatrice',
      category: 'technology',
      severity: 'unlikely',
      replacement: 'tinozza',
      note_for_author: 'Da verificare: nel 1943 la lavatrice in casa era probabilmente rarissima.',
    },
  ],
});

describe('runHistoryCheck', () => {
  it('stops after one call when no period is named', async () => {
    const { provider, requests } = scripted([NO_PERIOD]);
    const result = await runHistoryCheck({
      provider,
      text: 'La strada era deserta.',
      language: 'it',
    });
    expect(result.suggestions).toEqual([]);
    expect(result.calls).toBe(1);
    expect(requests[0]?.temperature).toBe(0);
  });

  it('ignores a period whose quote is not in the text (an invented period)', async () => {
    const { provider } = scripted([
      ok({ period_named: true, quote: 'anni Cinquanta', period_label: '1950s' }),
    ]);
    const result = await runHistoryCheck({
      provider,
      text: 'La strada era deserta.',
      language: 'it',
    });
    expect(result.suggestions).toEqual([]);
    expect(result.calls).toBe(1);
  });

  it('returns a period detail and an anachronism, each a hint to check', async () => {
    const { provider, requests } = scripted([PERIOD, REPORT]);
    const result = await runHistoryCheck({ provider, text: NAPOLI, language: 'it' });
    expect(result.calls).toBe(2);
    expect(result.periodLabel).toBe('Naples, 1943');
    expect(requests[1]?.systemInstruction).toContain('Naples, 1943');
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        kind: 'history',
        aspect: 'anachronism',
        original: 'lavatrice',
        proposals: ['tinozza'],
        // the model's own prefix is not doubled
        rationale: 'Da verificare: nel 1943 la lavatrice in casa era probabilmente rarissima.',
      }),
      expect.objectContaining({
        kind: 'history',
        aspect: 'period',
        original: 'Qualcuno correva verso il porto.',
        rationale:
          'Da verificare: In tempo di guerra le sirene dell’allarme aereo erano frequenti.',
      }),
    ]);
  });

  it('uses the English prefix for a book in English', async () => {
    const text = 'London, 1888. At the corner she zipped up her coat.';
    const { provider } = scripted([
      ok({ period_named: true, quote: 'London, 1888', period_label: 'London, 1888' }),
      ok({
        period_details: [],
        anachronisms: [
          {
            trigger_quote: 'zipped up',
            category: 'clothing',
            severity: 'impossible',
            replacement: 'buttoned up',
            note_for_author: 'Zips probably came much later.',
          },
        ],
      }),
    ]);
    const result = await runHistoryCheck({ provider, text, language: 'en' });
    expect(result.suggestions[0]?.rationale).toBe('To check: Zips probably came much later.');
  });

  it('drops items with an unknown category, a bad severity or a quote not in the text', async () => {
    const { provider } = scripted([
      PERIOD,
      ok({
        period_details: [
          {
            anchor_quote: 'Elena salì le scale.',
            category: 'weather',
            rewrite: 'x',
            note_for_author: 'n',
          },
        ],
        anachronisms: [
          {
            trigger_quote: 'lavatrice',
            category: 'technology',
            severity: 'maybe',
            replacement: 'tinozza',
            note_for_author: 'n',
          },
          {
            trigger_quote: 'televisore',
            category: 'technology',
            severity: 'impossible',
            replacement: 'radio',
            note_for_author: 'n',
          },
          {
            trigger_quote: 'porto',
            category: 'transport',
            severity: 'unlikely',
            replacement: 'porto',
            note_for_author: 'n',
          },
        ],
      }),
    ]);
    const result = await runHistoryCheck({ provider, text: NAPOLI, language: 'it' });
    expect(result.suggestions).toEqual([]);
    expect(result.dropped).toBe(4);
  });

  it('drops a replacement that repeats the words around the quote', async () => {
    const text = 'Torino, 1911. Pagò con una banconota da cinquanta euro e uscì.';
    const anachronism = (replacement: string) => ({
      trigger_quote: 'cinquanta euro',
      category: 'money',
      severity: 'impossible',
      replacement,
      note_for_author: 'L’euro non esisteva.',
    });
    const { provider } = scripted([
      ok({ period_named: true, quote: 'Torino, 1911', period_label: 'Turin, 1911' }),
      ok({
        period_details: [],
        anachronisms: [
          anachronism('una banconota da cinquanta lire'),
          anachronism('cinquanta lire e uscì'),
          anachronism('cinquanta lire'),
        ],
      }),
    ]);
    const result = await runHistoryCheck({ provider, text, language: 'it' });
    expect(result.suggestions.map((s) => s.proposals[0])).toEqual(['cinquanta lire']);
    expect(result.dropped).toBe(2);
  });

  it('drops a period detail that replaces words instead of adding a detail', async () => {
    const text = 'Ohio, 1925. She put his pie in the microwave and waited.';
    const { provider } = scripted([
      ok({ period_named: true, quote: 'Ohio, 1925', period_label: 'Ohio, 1925' }),
      ok({
        anachronisms: [],
        period_details: [
          {
            anchor_quote: 'She put his pie in the microwave and waited.',
            category: 'technology',
            rewrite: 'She put his pie in the oven and waited.',
            note_for_author: 'Microwaves did not exist.',
          },
          {
            anchor_quote: 'She put his pie in the microwave and waited.',
            category: 'objects',
            rewrite: 'She put his pie, still warm, in the microwave and waited by the stove.',
            note_for_author: 'Diners usually had a stove.',
          },
        ],
      }),
    ]);
    const result = await runHistoryCheck({ provider, text, language: 'en' });
    expect(result.suggestions.map((s) => s.proposals[0])).toEqual([
      'She put his pie, still warm, in the microwave and waited by the stove.',
    ]);
    expect(result.dropped).toBe(1);
  });

  it('never throws: a failed call means no history suggestions', async () => {
    const { provider } = scripted([{ ok: false, error: aiError('throttled', 'slow down') }]);
    const result = await runHistoryCheck({ provider, text: NAPOLI, language: 'it' });
    expect(result.suggestions).toEqual([]);
    expect(result.error?.kind).toBe('throttled');
  });

  it('caps the output: at most 2 period details and 3 anachronisms', async () => {
    const detail = (n: number) => ({
      anchor_quote: 'Elena salì le scale.',
      category: 'objects',
      rewrite: `Elena salì le scale ${n}.`,
      note_for_author: 'n',
    });
    const { provider } = scripted([
      PERIOD,
      ok({ period_details: [detail(1), detail(2), detail(3)], anachronisms: [] }),
    ]);
    const result = await runHistoryCheck({ provider, text: NAPOLI, language: 'it' });
    expect(result.suggestions).toHaveLength(2);
  });
});

describe('mergeWithHistory', () => {
  const sug = (kind: 'style' | 'history', original: string) => ({
    original,
    kind,
    ...(kind === 'history' ? { aspect: 'anachronism' as const } : {}),
    rationale: 'r',
    proposals: ['p'],
  });

  it('drops main suggestions that overlap a history one, and history from the main call', () => {
    const text = 'In cucina la madre aveva lasciato la lavatrice accesa. Elena uscì.';
    const merged = mergeWithHistory(
      [
        sug('style', 'In cucina la madre aveva lasciato la lavatrice accesa.'),
        sug('style', 'Elena uscì.'),
        sug('history', 'Elena'),
      ],
      [sug('history', 'lavatrice')],
      text,
    );
    expect(merged.map((s) => s.original)).toEqual(['Elena uscì.', 'lavatrice']);
  });
});

describe('history overlaps', () => {
  it('drops a period detail anchored on the sentence of a kept anachronism', async () => {
    const text = 'Ohio, 1925. She put his pie in the microwave and waited. The diner was empty.';
    const { provider } = scripted([
      ok({ period_named: true, quote: 'Ohio, 1925', period_label: 'Ohio, 1925' }),
      ok({
        anachronisms: [
          {
            trigger_quote: 'microwave',
            category: 'technology',
            severity: 'impossible',
            replacement: 'oven',
            note_for_author: 'Microwaves came much later.',
          },
        ],
        period_details: [
          {
            anchor_quote: 'She put his pie in the microwave and waited.',
            category: 'objects',
            rewrite: 'She put his pie in the microwave and waited by the coal stove.',
            note_for_author: 'n',
          },
          {
            anchor_quote: 'The diner was empty.',
            category: 'objects',
            rewrite: 'The diner was empty, the radio on.',
            note_for_author: 'n',
          },
        ],
      }),
    ]);
    const result = await runHistoryCheck({ provider, text, language: 'en' });
    expect(result.suggestions.map((s) => s.original)).toEqual([
      'microwave',
      'The diner was empty.',
    ]);
  });

  const sug = (
    kind: 'style' | 'grammar' | 'history',
    original: string,
    aspect?: 'period' | 'anachronism',
  ) => ({ original, kind, ...(aspect ? { aspect } : {}), rationale: 'r', proposals: ['p'] });

  it('same sentence, tip + error: grammar beats a period tip, an anachronism beats grammar', () => {
    const text = 'la radio era accesa. Nel salotto il televisore taceva.';
    const merged = mergeWithHistory(
      [sug('grammar', 'la radio'), sug('grammar', 'il televisore')],
      [
        sug('history', 'la radio era accesa.', 'period'),
        sug('history', 'televisore', 'anachronism'),
      ],
      text,
    );
    expect(merged.map((s) => s.original)).toEqual(['la radio', 'televisore']);
  });

  it('ignores the overlap check for an ambiguous main span (normalizeSuggestions drops it)', () => {
    const text = 'Il fumo saliva. Il fumo scendeva.';
    const merged = mergeWithHistory(
      [sug('style', 'Il fumo')],
      [sug('history', 'Il fumo saliva.', 'period')],
      text,
    );
    expect(merged.map((s) => s.original)).toEqual(['Il fumo', 'Il fumo saliva.']);
  });
});

describe('runHistoryCheckWithin', () => {
  it('gives up after its own deadline: no history, a timeout error, the refinement goes on', async () => {
    const hanging: AiProvider = {
      name: 'bedrock',
      modelName: 'fake-nova',
      generateJson: () => new Promise<AiResult>(() => undefined),
    };
    const started = Date.now();
    const result = await runHistoryCheckWithin(
      { provider: hanging, text: NAPOLI, language: 'it' },
      30,
    );
    expect(result.suggestions).toEqual([]);
    expect(result.error?.kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('returns the check result when it finishes in time', async () => {
    const { provider } = scripted([NO_PERIOD]);
    const result = await runHistoryCheckWithin({ provider, text: 'Testo.', language: 'it' }, 1000);
    expect(result.error).toBeUndefined();
    expect(result.calls).toBe(1);
  });
});

describe('history overlaps with a repeated word', () => {
  it('drops a tip whose anchor contains the anachronism, even when the word repeats', async () => {
    const text = 'Ohio, 1925. She put his pie in the microwave and waited. The microwave hummed.';
    const { provider } = scripted([
      ok({ period_named: true, quote: 'Ohio, 1925', period_label: 'Ohio, 1925' }),
      ok({
        anachronisms: [
          {
            trigger_quote: 'microwave',
            category: 'technology',
            severity: 'impossible',
            replacement: 'oven',
            note_for_author: 'Microwaves came much later.',
          },
        ],
        period_details: [
          {
            anchor_quote: 'She put his pie in the microwave and waited.',
            category: 'objects',
            rewrite: 'She put his pie in the microwave and waited by the coal stove.',
            note_for_author: 'n',
          },
        ],
      }),
    ]);
    const result = await runHistoryCheck({ provider, text, language: 'en' });
    expect(result.suggestions.some((s) => s.aspect === 'period')).toBe(false);
  });
});
