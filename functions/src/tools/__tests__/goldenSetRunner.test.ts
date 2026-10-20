import { ProviderModel } from '../../ai/provider/ProviderModel';
import { aiError, type AiProvider, type AiResult } from '../../ai/provider/types';
import { generateWithRetry } from '../goldenSetRunner';

const PROMPT = { systemInstruction: 's', userText: 'u', responseSchema: {} };
const GOOD: AiResult = { ok: true, value: { suggestions: [] } };

/** A provider that answers with the given results, one per call. */
function scripted(results: AiResult[]): { model: ProviderModel; calls: () => number } {
  let calls = 0;
  const provider: AiProvider = {
    name: 'bedrock',
    modelName: 'fake-nova',
    generateJson: async () => results[Math.min(calls++, results.length - 1)] as AiResult,
  };
  return { model: new ProviderModel(() => provider, 0), calls: () => calls };
}

describe('generateWithRetry', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it.each(['invalid_json', 'truncated'] as const)('retries after a %s reply', async (kind) => {
    const { model, calls } = scripted([{ ok: false, error: aiError(kind, 'bad reply') }, GOOD]);
    const result = await generateWithRetry([model], PROMPT);
    expect(result.output).toEqual({ suggestions: [] });
    expect(calls()).toBe(2);
  });

  it('retries after a reply that does not match the schema', async () => {
    const { model, calls } = scripted([{ ok: true, value: { suggestions: 'no' } }, GOOD]);
    await expect(generateWithRetry([model], PROMPT)).resolves.toBeDefined();
    expect(calls()).toBe(2);
  });

  it('stops at once on a non-retryable error such as auth', async () => {
    const { model, calls } = scripted([{ ok: false, error: aiError('auth', 'no credentials') }]);
    await expect(generateWithRetry([model], PROMPT)).rejects.toThrow('AI auth');
    expect(calls()).toBe(1);
  });
});
