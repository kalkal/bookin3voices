// BedrockNovaProvider with a fake Bedrock client (no network, no credentials):
// request shape, tool-use and text answers, and every failure as a value.

import { BedrockNovaProvider, mapBedrockError, type BedrockSender } from '../BedrockNovaProvider';
import type { AiResult } from '../types';

const REQUEST = {
  systemInstruction: 'You are an editor.',
  userText: 'Text to review.',
  responseSchema: {
    type: 'OBJECT',
    properties: { suggestions: { type: 'ARRAY', items: { type: 'STRING' } } },
    required: ['suggestions'],
    propertyOrdering: ['suggestions'],
  },
  temperature: 0.3,
  maxOutputTokens: 2048,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

type Sent = { input: Record<string, Loose>; options: { abortSignal?: AbortSignal } };

function fakeClient(respond: () => unknown | Promise<unknown>) {
  const sent: Sent[] = [];
  const client = {
    send: async (command: { input: Record<string, Loose> }, options: Sent['options']) => {
      sent.push({ input: command.input, options });
      return respond();
    },
  } as unknown as BedrockSender;
  return { client, sent };
}

function errorOf(result: AiResult) {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

function named(name: string, message = 'boom'): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

const toolAnswer = (input: unknown) => ({
  stopReason: 'tool_use',
  output: {
    message: {
      role: 'assistant',
      content: [{ toolUse: { toolUseId: '1', name: 'return_result', input } }],
    },
  },
});
const textAnswer = (text: string, stopReason = 'end_turn') => ({
  stopReason,
  output: { message: { role: 'assistant', content: [{ text }] } },
});

describe('BedrockNovaProvider', () => {
  it('builds a Converse request that forces a JSON-schema tool', async () => {
    const { client, sent } = fakeClient(() => toolAnswer({ suggestions: [] }));
    const provider = new BedrockNovaProvider({ client, modelId: 'amazon.nova-lite-v1:0' });

    const result = await provider.generateJson(REQUEST);

    expect(result).toEqual({ ok: true, value: { suggestions: [] } });
    const input = sent[0]?.input as Record<string, Loose>;
    expect(input.modelId).toBe('amazon.nova-lite-v1:0');
    expect(input.system).toEqual([{ text: 'You are an editor.' }]);
    expect(input.messages[0].content[0].text).toBe('Text to review.');
    expect(input.inferenceConfig).toEqual({ maxTokens: 2048, temperature: 0.3 });
    expect(input.toolConfig.toolChoice).toEqual({ tool: { name: 'return_result' } });
    // OpenAPI dialect converted to plain JSON Schema
    expect(input.toolConfig.tools[0].toolSpec.inputSchema.json).toEqual({
      type: 'object',
      properties: { suggestions: { type: 'array', items: { type: 'string' } } },
      required: ['suggestions'],
    });
    expect(sent[0]?.options.abortSignal).toBeDefined();
  });

  it('accepts a plain JSON text answer (also inside a code fence)', async () => {
    const plain = fakeClient(() => textAnswer('{"suggestions":["a"]}'));
    const fenced = fakeClient(() => textAnswer('```json\n{"suggestions":["b"]}\n```'));
    const make = (client: BedrockSender) => new BedrockNovaProvider({ client, modelId: 'm' });
    expect(await make(plain.client).generateJson(REQUEST)).toEqual({
      ok: true,
      value: { suggestions: ['a'] },
    });
    expect(await make(fenced.client).generateJson(REQUEST)).toEqual({
      ok: true,
      value: { suggestions: ['b'] },
    });
  });

  it('text that is not JSON comes back as invalid_json (not retryable)', async () => {
    const { client } = fakeClient(() => textAnswer('Sure! Here are my thoughts.'));
    const error = errorOf(
      await new BedrockNovaProvider({ client, modelId: 'm' }).generateJson(REQUEST),
    );
    expect(error.kind).toBe('invalid_json');
    expect(error.retryable).toBe(false);
  });

  it('throttling is a retryable value, not an exception', async () => {
    const { client } = fakeClient(() => {
      throw named('ThrottlingException');
    });
    const error = errorOf(
      await new BedrockNovaProvider({ client, modelId: 'm' }).generateJson(REQUEST),
    );
    expect(error.kind).toBe('throttled');
    expect(error.retryable).toBe(true);
  });

  it('a timeout (aborted call) is a retryable "timeout" value', async () => {
    const { client } = fakeClient(() => {
      throw named('TimeoutError', 'The operation was aborted due to timeout');
    });
    const error = errorOf(
      await new BedrockNovaProvider({ client, modelId: 'm' }).generateJson(REQUEST),
    );
    expect(error.kind).toBe('timeout');
    expect(error.retryable).toBe(true);
  });

  it('really aborts a call that never answers', async () => {
    const client = {
      send: (_c: unknown, options: Sent['options']) =>
        new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => reject(named('AbortError')));
        }),
    } as unknown as BedrockSender;
    const provider = new BedrockNovaProvider({ client, modelId: 'm', timeoutMs: 20 });
    expect(errorOf(await provider.generateJson(REQUEST)).kind).toBe('timeout');
  });

  it('max_tokens is "truncated" and content_filtered is "blocked"', async () => {
    const cut = fakeClient(() => textAnswer('{"sugg', 'max_tokens'));
    const filtered = fakeClient(() => textAnswer('', 'content_filtered'));
    const make = (client: BedrockSender) => new BedrockNovaProvider({ client, modelId: 'm' });
    expect(errorOf(await make(cut.client).generateJson(REQUEST)).kind).toBe('truncated');
    expect(errorOf(await make(filtered.client).generateJson(REQUEST)).kind).toBe('blocked');
  });

  it.each([
    ['AccessDeniedException', 'auth', false],
    ['ValidationException', 'bad_request', false],
    ['ServiceUnavailableException', 'unavailable', true],
    ['SomethingElse', 'unknown', false],
  ])('maps %s to %s', (name, kind, retryable) => {
    const error = errorOf(mapBedrockError(named(name)));
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
  });

  it('error messages never include the prompt text', async () => {
    const { client } = fakeClient(() => {
      throw named('ValidationException', 'bad model id');
    });
    const error = errorOf(
      await new BedrockNovaProvider({ client, modelId: 'm' }).generateJson(REQUEST),
    );
    expect(JSON.stringify(error)).not.toContain('Text to review.');
  });
});
