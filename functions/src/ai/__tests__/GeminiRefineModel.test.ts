// Tests of the Gemini RefineModel with a fake fetch: URL, key in the header,
// generationConfig with the refine temperature, typed HTTP errors.

import { GeminiHttpError, GeminiRefineModel, isRetryableGeminiError } from '../GeminiRefineModel';
import { buildRefinePrompt } from '../refinePrompt';

const PROMPT = buildRefinePrompt({
  styleBible: 'Bibbia.',
  fewShots: 'Esempi.',
  book: { title: 'T', genre: '', language: 'it', synopsis: '' },
  chapter: { title: 'C', outline: null },
  text: 'Testo di prova.',
});

function envelope(payload: unknown): unknown {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] };
}

function fakeFetch(status: number, body: unknown): { fn: typeof fetch; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const fn = (async (...args: unknown[]) => {
    calls.push(args);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('GeminiRefineModel', () => {
  it('calls generateContent with the configured model, the key in the header and temperature 0.3', async () => {
    const { fn, calls } = fakeFetch(200, envelope({ suggestions: [] }));
    const model = new GeminiRefineModel({
      model: () => 'gemini-3.5-flash',
      apiKey: () => 'chiave-di-prova',
      fetchFn: fn,
    });

    const result = await model.generate(PROMPT);

    expect(result).toEqual({ suggestions: [] });
    const [url, init] = calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    );
    expect(init.headers['x-goog-api-key']).toBe('chiave-di-prova');
    const body = JSON.parse(init.body) as {
      generationConfig: { temperature: number; responseMimeType: string };
      systemInstruction: { parts: Array<{ text: string }> };
    };
    expect(body.generationConfig.temperature).toBe(0.3);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.systemInstruction.parts[0]?.text).toContain('Bibbia.');
  });

  it('non-2xx HTTP → GeminiHttpError with status (503 is retryable)', async () => {
    const { fn } = fakeFetch(503, { error: 'high demand' });
    const model = new GeminiRefineModel({
      model: () => 'gemini-3.6-flash',
      apiKey: () => 'k',
      fetchFn: fn,
    });
    let caught: unknown;
    try {
      await model.generate(PROMPT);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GeminiHttpError);
    expect((caught as GeminiHttpError).status).toBe(503);
    expect(isRetryableGeminiError(caught)).toBe(true);
    expect((caught as Error).message).not.toContain('k'); // never the key in logs
  });

  it('400 is not retryable; neither are other errors', () => {
    expect(isRetryableGeminiError(new GeminiHttpError(400, 'bad schema'))).toBe(false);
    expect(isRetryableGeminiError(new Error('boom'))).toBe(false);
  });

  it('response without candidate text → descriptive error', async () => {
    const { fn } = fakeFetch(200, { candidates: [] });
    const model = new GeminiRefineModel({ model: () => 'm', apiKey: () => 'k', fetchFn: fn });
    await expect(model.generate(PROMPT)).rejects.toThrow('no candidate');
  });

  it("non-JSON text → SyntaxError (triggers the caller's retry)", async () => {
    const { fn } = fakeFetch(200, {
      candidates: [{ content: { parts: [{ text: 'non-json' }] } }],
    });
    const model = new GeminiRefineModel({ model: () => 'm', apiKey: () => 'k', fetchFn: fn });
    await expect(model.generate(PROMPT)).rejects.toThrow(SyntaxError);
  });
});
