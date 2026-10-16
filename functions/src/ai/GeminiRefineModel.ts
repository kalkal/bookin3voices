// RefineModel on Gemini: a direct REST call (plain fetch to generateContent with
// structured output); the API key is never in the repo or in logs. Intentional
// differences from the other callers: temperature 0.3 and the refine prompt.

import {
  extractCandidateText,
  GEMINI_DEFAULT_TIMEOUT_MS,
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_SAFETY_SETTINGS,
  isTimeoutError,
} from './geminiResponse';
import { REFINE_TEMPERATURE, type RefinePrompt } from './refinePrompt';
import type { RefineModel } from './refineTypes';

export class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Gemini HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = 'GeminiHttpError';
  }
}

/** HTTP errors worth retrying or handing to the fallback model
 *  (flash models can answer 503 "high demand" at peak times). */
export function isRetryableGeminiError(error: unknown): boolean {
  return (
    (error instanceof GeminiHttpError && [408, 429, 500, 502, 503, 504].includes(error.status)) ||
    isTimeoutError(error)
  );
}

export interface GeminiRefineModelOptions {
  /** Model name (from config, never hard-coded): resolved only at runtime. */
  model: () => string;
  /** The key is resolved on every call (secrets exist only at runtime). */
  apiKey: () => string;
  /** fetch, injectable in tests. */
  fetchFn?: typeof fetch;
  baseUrl?: string;
  /** Temperature (default: the refine temperature, 0.3). */
  temperature?: number;
  /** Network timeout per call, ms (default 80 s). */
  timeoutMs?: number;
}

export class GeminiRefineModel implements RefineModel {
  private readonly model: () => string;
  private readonly apiKey: () => string;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(options: GeminiRefineModelOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.temperature = options.temperature ?? REFINE_TEMPERATURE;
    this.timeoutMs = options.timeoutMs ?? GEMINI_DEFAULT_TIMEOUT_MS;
  }

  get modelName(): string {
    return this.model();
  }

  /** The candidate JSON, NOT yet validated (parse, don't validate, at the boundary). */
  async generate(prompt: RefinePrompt): Promise<unknown> {
    const response = await this.fetchFn(
      `${this.baseUrl}/models/${this.modelName}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: prompt.userText }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: prompt.responseSchema,
            temperature: this.temperature,
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          },
          safetySettings: GEMINI_SAFETY_SETTINGS,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      throw new GeminiHttpError(response.status, await response.text());
    }

    const text = extractCandidateText(await response.json());
    return JSON.parse(text) as unknown;
  }
}
