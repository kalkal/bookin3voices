// Catalogo dei motori AI (Strategy `AiProvider`). SOLO tipi e dati
// puri, nessun import React/React Native/Expo: queste definizioni sono pensate
// per essere riusate tali e quali dalle Cloud Functions (facade AiService),
// che leggeranno il provider attivo da `settings/app.aiProvider`.

/** Id dei provider innestabili. Oggi solo Gemini (unico dell'MVP). */
export const AI_PROVIDER_IDS = ['gemini'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/** Il default di `settings/app.aiProvider`. */
export const DEFAULT_AI_PROVIDER_ID: AiProviderId = 'gemini';

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
    id: 'gemini',
    label: 'Google Gemini',
    tiers: [
      {
        id: 'flash',
        label: 'Flash',
        description: 'Suggerimenti rapidi ed economici — il tier di lavoro',
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
