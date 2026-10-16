// Amazon Nova through Amazon Bedrock (Converse API).
//
// Nova has no native "structured output" mode, so the JSON contract is
// enforced the documented way: one tool whose input schema IS the response
// schema, with toolChoice forcing the model to call it. The tool input comes
// back already parsed. Plain-text JSON (optionally fenced) is accepted as a
// fallback. Credentials come from the standard AWS provider chain (env vars,
// shared config, IAM role); nothing is read or stored here.

import { ConverseCommand, type BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { parseJsonLoose } from './json';
import { toJsonSchema } from './schema';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TIMEOUT_MS,
  fail,
  type AiJsonRequest,
  type AiProvider,
  type AiResult,
} from './types';

export const DEFAULT_NOVA_MODEL_ID = 'amazon.nova-pro-v1:0';
const TOOL_NAME = 'return_result';

/** The only part of the SDK client we need: lets tests inject a fake. */
export type BedrockSender = Pick<BedrockRuntimeClient, 'send'>;

export interface BedrockNovaProviderOptions {
  client: BedrockSender;
  /** Model id or inference profile id (e.g. amazon.nova-pro-v1:0, us.amazon.nova-pro-v1:0). */
  modelId: string;
  timeoutMs?: number;
}

export class BedrockNovaProvider implements AiProvider {
  readonly name = 'bedrock' as const;
  readonly modelName: string;
  private readonly client: BedrockSender;
  private readonly timeoutMs: number;

  constructor(options: BedrockNovaProviderOptions) {
    this.client = options.client;
    this.modelName = options.modelId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generateJson(request: AiJsonRequest): Promise<AiResult> {
    const command = new ConverseCommand({
      modelId: this.modelName,
      system: [{ text: request.systemInstruction }],
      messages: [{ role: 'user', content: [{ text: request.userText }] }],
      inferenceConfig: {
        maxTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        temperature: Math.min(1, Math.max(0, request.temperature)),
      },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: TOOL_NAME,
              description: 'Return the final answer as structured data.',
              inputSchema: { json: toJsonSchema(request.responseSchema) as never },
            },
          },
        ],
        toolChoice: { tool: { name: TOOL_NAME } },
      },
    });

    let response;
    try {
      response = await this.client.send(command, {
        abortSignal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return mapBedrockError(error);
    }

    const stop = response.stopReason;
    if (stop === 'content_filtered' || stop === 'guardrail_intervened') {
      return fail('blocked', `Bedrock stopped the answer (${stop})`);
    }
    if (stop === 'max_tokens') return fail('truncated', 'Bedrock output truncated (max_tokens)');

    const blocks = response.output?.message?.content ?? [];
    const toolUse = blocks.find((block) => block.toolUse !== undefined)?.toolUse;
    if (toolUse?.input !== undefined && toolUse.input !== null) {
      return { ok: true, value: toolUse.input };
    }
    const text = blocks
      .map((block) => block.text ?? '')
      .join('')
      .trim();
    if (text === '') return fail('invalid_json', 'Bedrock returned no content');
    const parsed = parseJsonLoose(text);
    return parsed.ok
      ? { ok: true, value: parsed.value }
      : fail('invalid_json', 'Answer is not JSON');
  }
}

/** Maps SDK exceptions (by name, so no SDK class imports are needed) to AiError values. */
export function mapBedrockError(error: unknown): AiResult {
  const name = error instanceof Error ? error.name : '';
  const detail = error instanceof Error ? error.message : String(error);
  switch (name) {
    case 'AbortError':
    case 'TimeoutError':
    case 'ModelTimeoutException':
      return fail('timeout', `Bedrock call timed out (${name})`);
    case 'ThrottlingException':
    case 'ServiceQuotaExceededException':
      return fail('throttled', `Bedrock throttled the request (${name})`);
    case 'InternalServerException':
    case 'ServiceUnavailableException':
    case 'ModelNotReadyException':
      return fail('unavailable', `Bedrock unavailable (${name})`);
    case 'AccessDeniedException':
    case 'UnrecognizedClientException':
    case 'ExpiredTokenException':
    case 'CredentialsProviderError':
      return fail('auth', `Bedrock credentials/permissions problem (${name}): ${detail}`);
    case 'ValidationException':
    case 'ResourceNotFoundException':
    case 'ModelErrorException':
      return fail('bad_request', `Bedrock rejected the request (${name}): ${detail}`);
    default:
      return fail('unknown', `Bedrock error (${name || 'unknown'}): ${detail}`);
  }
}
