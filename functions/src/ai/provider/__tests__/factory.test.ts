import {
  bedrockModelId,
  createProvider,
  selectProviderName,
  type ProviderFactoryDeps,
} from '../factory';
import { ProviderModel } from '../ProviderModel';
import { AiProviderError, type AiProvider, type AiResult } from '../types';

const fakeClient = () => ({ send: async () => ({}) }) as never;
const deps = (env: Record<string, string>): ProviderFactoryDeps => ({
  env,
  createBedrockClient: fakeClient,
});

describe('provider selection', () => {
  it('defaults to Amazon Nova on Bedrock', () => {
    expect(selectProviderName({})).toBe('bedrock');
    const provider = createProvider(deps({}), 'primary');
    expect(provider.name).toBe('bedrock');
    expect(provider.modelName).toBe('amazon.nova-pro-v1:0');
  });

  it('AI_PROVIDER=bedrock is accepted (case-insensitive)', () => {
    expect(selectProviderName({ AI_PROVIDER: ' Bedrock ' })).toBe('bedrock');
    expect(createProvider(deps({ AI_PROVIDER: 'BEDROCK' }), 'primary').name).toBe('bedrock');
  });

  it('an unknown AI_PROVIDER fails loudly', () => {
    expect(() => selectProviderName({ AI_PROVIDER: 'skynet' })).toThrow(
      'AI_PROVIDER must be one of',
    );
  });

  it('building a model with another AI_PROVIDER fails loudly, never falls back', () => {
    expect(() => createProvider(deps({ AI_PROVIDER: 'skynet' }), 'primary')).toThrow(
      'AI_PROVIDER must be one of bedrock',
    );
  });

  it('Bedrock model ids come from env per role; no fallback by default', () => {
    const env = { BEDROCK_MODEL_ID: 'us.amazon.nova-lite-v1:0', BEDROCK_MODEL_ID_OUTLINE: 'o' };
    expect(bedrockModelId(env, 'primary')).toBe('us.amazon.nova-lite-v1:0');
    expect(bedrockModelId(env, 'outline')).toBe('o');
    expect(bedrockModelId({}, 'outline')).toBe('amazon.nova-pro-v1:0');
    expect(bedrockModelId(env, 'fallback')).toBe('');
  });

  it('the region comes from BEDROCK_REGION, then AWS_REGION, then us-east-1', () => {
    const regions: string[] = [];
    const make = (env: Record<string, string>) =>
      createProvider(
        {
          ...deps(env),
          createBedrockClient: (region) => {
            regions.push(region);
            return fakeClient();
          },
        },
        'primary',
      );
    make({});
    make({ AWS_REGION: 'eu-north-1' });
    make({ AWS_REGION: 'eu-north-1', BEDROCK_REGION: 'us-east-2' });
    expect(regions).toEqual(['us-east-1', 'eu-north-1', 'us-east-2']);
  });
});

describe('ProviderModel (adapter to the existing callables)', () => {
  const fake = (result: AiResult): AiProvider => ({
    name: 'bedrock',
    modelName: 'm',
    generateJson: async () => result,
  });
  const prompt = { systemInstruction: 's', userText: 'u', responseSchema: {} };

  it('returns the value on success', async () => {
    const model = new ProviderModel(() => fake({ ok: true, value: { a: 1 } }), 0.3);
    await expect(model.generate(prompt)).resolves.toEqual({ a: 1 });
  });

  it('throws a typed error carrying the AiError on failure', async () => {
    const failing = fake({
      ok: false,
      error: { kind: 'throttled', retryable: true, message: 'slow down' },
    });
    await expect(new ProviderModel(() => failing, 0.3).generate(prompt)).rejects.toBeInstanceOf(
      AiProviderError,
    );
  });
});
