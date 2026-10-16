// The single port every AI call goes through (refineChapter, generateOutline).
// Same input and output whatever the vendor: a prompt + JSON schema in, a
// parsed JSON value out. Failures are VALUES (AiResult), never exceptions, so
// callers decide about retry / fallback explicitly and nothing is swallowed.

export interface AiJsonRequest {
  systemInstruction: string;
  userText: string;
  /** Response shape in the Gemini/OpenAPI dialect (upper-case type names). */
  responseSchema: Record<string, unknown>;
  temperature: number;
  /** Output budget; keep below the smallest supported model limit (Nova Lite and Pro: 10K). */
  maxOutputTokens?: number;
}

export type AiErrorKind =
  | 'throttled' // rate limit / quota: retry later or fall back
  | 'timeout' // no answer within the per-call timeout
  | 'unavailable' // 5xx, model not ready
  | 'auth' // missing or insufficient credentials / permissions
  | 'bad_request' // wrong model id, rejected schema or parameters
  | 'blocked' // safety filter / guardrail
  | 'truncated' // output cut at the token limit
  | 'invalid_json' // the model answered, but not with parseable JSON
  | 'unknown';

export interface AiError {
  kind: AiErrorKind;
  /** True when trying again (or another model) can plausibly succeed. */
  retryable: boolean;
  /** Safe to log: never contains the prompt, the text or any credential. */
  message: string;
}

export type AiResult = { ok: true; value: unknown } | { ok: false; error: AiError };

export const AI_PROVIDER_NAMES = ['bedrock', 'gemini'] as const;
export type AiProviderName = (typeof AI_PROVIDER_NAMES)[number];

export interface AiProvider {
  readonly name: AiProviderName;
  readonly modelName: string;
  /** Never throws: every failure comes back as `{ ok: false, error }`. */
  generateJson(request: AiJsonRequest): Promise<AiResult>;
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/** Per-call timeout: three sequential attempts must fit the 300 s function limit. */
export const DEFAULT_TIMEOUT_MS = 80_000;

const RETRYABLE: ReadonlySet<AiErrorKind> = new Set(['throttled', 'timeout', 'unavailable']);

export function aiError(kind: AiErrorKind, message: string): AiError {
  return { kind, retryable: RETRYABLE.has(kind), message: message.slice(0, 300) };
}

export function fail(kind: AiErrorKind, message: string): AiResult {
  return { ok: false, error: aiError(kind, message) };
}

/** Thrown only by the legacy-model adapter, to feed the existing retry loops. */
export class AiProviderError extends Error {
  constructor(readonly detail: AiError) {
    super(`AI ${detail.kind}: ${detail.message}`);
    this.name = 'AiProviderError';
  }
}

export function isRetryableAiError(error: unknown): boolean {
  return error instanceof AiProviderError && error.detail.retryable;
}
