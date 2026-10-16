// Catalogo dei motori AI (Strategy `AiProvider`). SOLO tipi e dati
// puri, nessun import React/React Native/Expo. Il motore usato dalle
// rifiniture lo decide il server (variabile AI_PROVIDER delle Cloud Functions,
// predefinito Amazon Nova su Bedrock); `settings/app.aiProvider` è la
// preferenza salvata, con gli stessi id del server.

/** Id dei provider innestabili, allineati a functions/src/ai/refineChapter.ts. */
export const AI_PROVIDER_IDS = ['bedrock', 'gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Il default di `settings/app.aiProvider`: lo stesso del server. */
export const DEFAULT_AI_PROVIDER_ID: AiProviderId = 'bedrock';

export interface AiProviderTier {
  id: string;
  label: string;
  /** Chiave i18n della riga per la UI (a cosa serve questo tier); si risolve con t() al render. */
  descriptionKey: string;
}

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** Tier disponibili, mostrati come informazione nel pannello Impostazioni. */
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
