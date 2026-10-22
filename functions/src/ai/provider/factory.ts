// Provider selection: Amazon Nova on Bedrock is the only provider. AI_PROVIDER
// may only say `bedrock`; any other value fails loudly at startup.

import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { BedrockNovaProvider, DEFAULT_NOVA_MODEL_ID } from './BedrockNovaProvider';
import { AI_PROVIDER_NAMES, type AiProvider, type AiProviderName } from './types';

export type Env = Record<string, string | undefined>;

export const DEFAULT_PROVIDER: AiProviderName = 'bedrock';
export const DEFAULT_AWS_REGION = 'us-east-1';
export const OUTLINE_TIMEOUT_MS = 140_000;

/** Which provider the deployment uses. Unknown values fail loudly, never silently. */
export function selectProviderName(env: Env): AiProviderName {
  const raw = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (raw === '') return DEFAULT_PROVIDER;
  if ((AI_PROVIDER_NAMES as readonly string[]).includes(raw)) return raw as AiProviderName;
  throw new Error(
    `AI_PROVIDER must be one of ${AI_PROVIDER_NAMES.join(', ')} (got "${raw.slice(0, 20)}")`,
  );
}

export type ModelRole = 'primary' | 'fallback' | 'outline';

export interface ProviderFactoryDeps {
  env: Env;
  /** Injectable for tests; default builds a real Bedrock client. */
  createBedrockClient?: (region: string) => BedrockRuntimeClient;
}

/** Model id for a role, from env. Empty fallback = no fallback model. */
export function bedrockModelId(env: Env, role: ModelRole): string {
  const base = (env.BEDROCK_MODEL_ID ?? '').trim() || DEFAULT_NOVA_MODEL_ID;
  if (role === 'fallback') return (env.BEDROCK_MODEL_ID_FALLBACK ?? '').trim();
  if (role === 'outline') return (env.BEDROCK_MODEL_ID_OUTLINE ?? '').trim() || base;
  return base;
}

/** Builds the provider for a role. Call lazily (at request time). */
export function createProvider(deps: ProviderFactoryDeps, role: ModelRole): AiProvider {
  // a misconfigured AI_PROVIDER stops the call instead of quietly using something else
  selectProviderName(deps.env);
  // the outline uses the larger model and 2 attempts: allow a longer single call
  const timeoutMs = role === 'outline' ? OUTLINE_TIMEOUT_MS : undefined;
  const region =
    (deps.env.BEDROCK_REGION ?? deps.env.AWS_REGION ?? '').trim() || DEFAULT_AWS_REGION;
  const make = deps.createBedrockClient ?? ((r: string) => new BedrockRuntimeClient({ region: r }));
  return new BedrockNovaProvider({
    client: make(region),
    modelId: bedrockModelId(deps.env, role),
    timeoutMs,
  });
}
