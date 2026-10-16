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
  /** Una riga per la UI: a cosa serve questo tier. */
  description: string;
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
        description: 'Il modello predefinito: segue meglio lo stile scelto',
      },
      {
        id: 'lite',
        label: 'Lite',
        description: 'Più economico, suggerimenti più semplici',
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
        description: 'Suggerimenti rapidi ed economici',
      },
      {
        id: 'pro',
        label: 'Pro',
        description: 'Rifiniture più accurate sui passaggi difficili',
      },
    ],
  },
];

export function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}
