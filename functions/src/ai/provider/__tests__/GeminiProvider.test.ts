// GeminiProvider with a fake fetch: request shape, a hand-written outline
// response in the Gemini envelope format (fictional synopsis), and every failure mode
// coming back as a value.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeOutlineCandidate } from '../../generateOutline';
import { buildOutlinePrompt } from '../../outlinePrompt';
import { outlineSchema } from '../../types';
import { GeminiProvider } from '../GeminiProvider';
import type { AiResult } from '../types';

const ENVELOPE = readFileSync(
  join(__dirname, '..', '..', '__fixtures__', 'gemini-outline-envelope.json'),
  'utf8',
);
const PROMPT = buildOutlinePrompt({
  synopsis:
    'A beekeeper takes over the hives of an old mill and finds an ancient pact with the valley.',
  book: { title: 'The Mill of Rocca Bassa', genre: 'novel', language: 'en' },
  style: 'suspense',
  writtenChapterTitles: [],
});
const REQUEST = { ...PROMPT, temperature: 0.7, maxOutputTokens: 4096 };

function fakeFetch(status: number, body: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
  return { fetchFn, calls };
}

function provider(fetchFn: typeof fetch) {
  return new GeminiProvider({ model: () => 'gemini-test', apiKey: () => 'test-key', fetchFn });
}

function errorOf(result: AiResult) {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

describe('GeminiProvider', () => {
  it('sends a structured-output request with key, schema, token budget and safety settings', async () => {
    const { fetchFn, calls } = fakeFetch(200, ENVELOPE);
    await provider(fetchFn).generateJson(REQUEST);

    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    );
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.systemInstruction.parts[0].text).toBe(PROMPT.systemInstruction);
    expect(body.contents[0].parts[0].text).toBe(PROMPT.userText);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toEqual(PROMPT.responseSchema);
    expect(body.generationConfig.temperature).toBe(0.7);
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(0);
    expect(body.safetySettings.length).toBeGreaterThan(0);
    expect(calls[0]?.init.signal).toBeDefined();
  });

  it('the hand-written fixture response yields a valid outline', async () => {
    const result = await provider(fakeFetch(200, ENVELOPE).fetchFn).generateJson(REQUEST);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = outlineSchema.safeParse(sanitizeOutlineCandidate(result.value));
      expect(parsed.success).toBe(true);
    }
  });

  it.each([
    [429, 'throttled', true],
    [503, 'unavailable', true],
    [403, 'auth', false],
    [404, 'bad_request', false],
  ])('HTTP %i becomes a %s value (retryable: %s)', async (status, kind, retryable) => {
    const error = errorOf(
      await provider(fakeFetch(status, '{"error":"x"}').fetchFn).generateJson(REQUEST),
    );
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
  });

  it('a safety-blocked answer is "blocked", not a generic empty answer', async () => {
    const body = JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] });
    expect(errorOf(await provider(fakeFetch(200, body).fetchFn).generateJson(REQUEST)).kind).toBe(
      'blocked',
    );
  });

  it('a prompt blocked up front is "blocked"', async () => {
    const body = JSON.stringify({ promptFeedback: { blockReason: 'OTHER' } });
    expect(errorOf(await provider(fakeFetch(200, body).fetchFn).generateJson(REQUEST)).kind).toBe(
      'blocked',
    );
  });

  it('MAX_TOKENS is "truncated"', async () => {
    const body = JSON.stringify({
      candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a":' }] } }],
    });
    expect(errorOf(await provider(fakeFetch(200, body).fetchFn).generateJson(REQUEST)).kind).toBe(
      'truncated',
    );
  });

  it('non-JSON text is "invalid_json"', async () => {
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] });
    expect(errorOf(await provider(fakeFetch(200, body).fetchFn).generateJson(REQUEST)).kind).toBe(
      'invalid_json',
    );
  });

  it('thought parts are ignored and text parts are joined', async () => {
    const body = JSON.stringify({
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            parts: [{ text: 'thinking...', thought: true }, { text: '{"a":' }, { text: '1}' }],
          },
        },
      ],
    });
    const result = await provider(fakeFetch(200, body).fetchFn).generateJson(REQUEST);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('a timeout becomes a retryable "timeout" value', async () => {
    const fetchFn = (async () => {
      throw new DOMException('timed out', 'TimeoutError');
    }) as unknown as typeof fetch;
    const error = errorOf(await provider(fetchFn).generateJson(REQUEST));
    expect(error.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
  });
});
