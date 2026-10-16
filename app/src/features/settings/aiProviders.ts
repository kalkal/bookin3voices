// Catalog of AI engines (`AiProvider` Strategy). ONLY pure types and data,
// no React/React Native/Expo imports. The engine used for
// refinements is decided by the server (AI_PROVIDER variable of the Cloud Functions,
// default Amazon Nova on Bedrock); `settings/app.aiProvider` is the
// saved preference, with the same ids as the server.

/** Ids of the pluggable providers, aligned with functions/src/ai/refineChapter.ts. */
export const AI_PROVIDER_IDS = ['bedrock', 'gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** The default of `settings/app.aiProvider`: the same as the server. */
export const DEFAULT_AI_PROVIDER_ID: AiProviderId = 'bedrock';

export interface AiProviderTier {
  id: string;
  label: string;
  /** i18n key of the UI row (what this tier is for); resolved with t() at render. */
  descriptionKey: string;
}

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** Available tiers, shown as information in the Settings panel. */
  tiers: readonly AiProviderTier[];
}

export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: 'bedrock',
    label: 'Amazon Nova (Bedrock)',
    tiers: [
      {
        id: 'pro',
        label: 'Pro',
        descriptionKey: 'settings.ai.bedrock.pro',
      },
      {
        id: 'lite',
        label: 'Lite',
        descriptionKey: 'settings.ai.bedrock.lite',
      },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    tiers: [
      {
        id: 'flash',
        label: 'Flash',
        descriptionKey: 'settings.ai.gemini.flash',
      },
      {
        id: 'pro',
        label: 'Pro',
        descriptionKey: 'settings.ai.gemini.pro',
      },
    ],
  },
];

export function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}
