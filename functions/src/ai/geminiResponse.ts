// Shared reading of a Gemini generateContent response. Turns the situations
// that used to surface as a generic "no candidate text" (safety block, token
// limit, empty candidate) into explicit, loggable errors.

import { z } from 'zod';

const envelopeSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({
            parts: z
              .array(z.object({ text: z.string().optional(), thought: z.boolean().optional() }))
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

/** The model answered, but not with usable text (blocked, truncated, empty). */
export class GeminiNoContentError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = 'GeminiNoContentError';
  }
}

/**
 * Extracts the JSON text of the first candidate: concatenates the non-thought
 * text parts (thinking models may emit several parts) and fails with an
 * explicit reason when the response was blocked or cut off.
 */
export function extractCandidateText(raw: unknown): string {
  const envelope = envelopeSchema.parse(raw);
  const blockReason = envelope.promptFeedback?.blockReason;
  if (blockReason !== undefined) {
    throw new GeminiNoContentError('blocked', `Gemini blocked the prompt (${blockReason})`);
  }
  const candidate = envelope.candidates?.[0];
  if (candidate === undefined) {
    throw new GeminiNoContentError('no-candidate', 'Gemini returned no candidate');
  }
  const text = (candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true && part.text !== undefined)
    .map((part) => part.text as string)
    .join('');
  const finish = candidate.finishReason;
  if (text === '') {
    throw new GeminiNoContentError(
      finish ?? 'empty',
      `Gemini returned no text (finishReason=${finish ?? 'none'})`,
    );
  }
  if (finish === 'MAX_TOKENS') {
    throw new GeminiNoContentError('MAX_TOKENS', 'Gemini output truncated (MAX_TOKENS)');
  }
  return text;
}

/**
 * Generation settings shared by the text-editing calls. Fiction (suspense,
 * horror) trips the default safety filters, so only high-probability harm is
 * blocked; the output budget is explicit so a long JSON answer is not cut.
 */
export const GEMINI_SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

export const GEMINI_MAX_OUTPUT_TOKENS = 16384;
/** Per-call network timeout: 3 sequential attempts must fit the 300 s function limit. */
export const GEMINI_DEFAULT_TIMEOUT_MS = 80_000;

/** True for the error thrown by AbortSignal.timeout(). */
export function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    ((error as { name: unknown }).name === 'TimeoutError' ||
      (error as { name: unknown }).name === 'AbortError')
  );
}
