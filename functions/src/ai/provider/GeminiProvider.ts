// Gemini behind the common AiProvider port: wraps the REST client
// (GeminiRefineModel) and converts its exceptions into AiError values.

import { GeminiHttpError, GeminiRefineModel } from '../GeminiRefineModel';
import { GeminiNoContentError, isTimeoutError } from '../geminiResponse';
import {
  DEFAULT_TIMEOUT_MS,
  fail,
  type AiJsonRequest,
  type AiProvider,
  type AiResult,
} from './types';

export interface GeminiProviderOptions {
  /** Resolved at call time: params and secrets only exist at runtime. */
  model: () => string;
  apiKey: () => string;
  fetchFn?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;

  constructor(private readonly options: GeminiProviderOptions) {}

  get modelName(): string {
    return this.options.model();
  }

  async generateJson(request: AiJsonRequest): Promise<AiResult> {
    const client = new GeminiRefineModel({
      model: this.options.model,
      apiKey: this.options.apiKey,
      fetchFn: this.options.fetchFn,
      baseUrl: this.options.baseUrl,
      temperature: request.temperature,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    try {
      return { ok: true, value: await client.generate(request) };
    } catch (error) {
      return mapGeminiError(error);
    }
  }
}

export function mapGeminiError(error: unknown): AiResult {
  if (isTimeoutError(error)) return fail('timeout', 'Gemini call timed out');
  if (error instanceof GeminiHttpError) {
    const s = error.status;
    if (s === 429) return fail('throttled', error.message);
    if (s === 401 || s === 403) return fail('auth', error.message);
    if (s === 408 || s >= 500) return fail('unavailable', error.message);
    return fail('bad_request', error.message);
  }
  if (error instanceof GeminiNoContentError) {
    if (error.reason === 'MAX_TOKENS') return fail('truncated', error.message);
    if (/^(blocked|SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION)$/.test(error.reason)) {
      return fail('blocked', error.message);
    }
    return fail('invalid_json', error.message);
  }
  if (error instanceof SyntaxError) return fail('invalid_json', 'Gemini answer is not valid JSON');
  return fail('unknown', error instanceof Error ? error.message : String(error));
}
