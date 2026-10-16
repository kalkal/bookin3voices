// Nomi dei modelli Gemini per tier: il nome vive in CONFIG, mai
// cablato nel codice — i parametri firebase-functions si sovrascrivono da
// .env/deploy senza toccare il codice. Default (verificati sull'endpoint
// ListModels):
//  - flash: gemini-3.6-flash (default);
//  - pro:   gemini-3.1-pro-preview — l'unico Pro testuale della famiglia
//    Gemini 3 oggi esposto; il 2.5-pro va in pensione il 16/10/2026.
// L'outline usa il tier PRO di default.

import { defineString } from 'firebase-functions/params';

export const AI_TIERS = ['flash', 'pro'] as const;
export type AiTier = (typeof AI_TIERS)[number];

const geminiModelFlash = defineString('GEMINI_MODEL_FLASH', {
  default: 'gemini-3.6-flash',
  description: 'Modello Gemini del tier Flash (rifiniture correnti)',
});

const geminiModelPro = defineString('GEMINI_MODEL_PRO', {
  default: 'gemini-3.1-pro-preview',
  description: 'Modello Gemini del tier Pro (outline e revisioni capitolo intero)',
});

/** Nome del modello per tier, risolto a runtime dalla config. */
export function modelForTier(tier: AiTier): string {
  return tier === 'pro' ? geminiModelPro.value() : geminiModelFlash.value();
}

/** Tier usato da generateOutline (outline sul tier Pro). */
export const OUTLINE_TIER: AiTier = 'pro';

const geminiModelRefine = defineString('GEMINI_MODEL_REFINE', {
  default: '',
  description:
    'Modello della rifinitura capitolo; vuoto = tier Flash. Ogni cambio va rigiocato sul golden set (npm run golden).',
});

const geminiModelRefineFallback = defineString('GEMINI_MODEL_REFINE_FALLBACK', {
  default: 'gemini-3.6-flash',
  description:
    'Modello di riserva della rifinitura (usato su 429/5xx del primario); vuoto = nessuna riserva.',
});

/** Modello primario di refineChapter, risolto a runtime dalla config. */
export function refineModelName(): string {
  const configured = geminiModelRefine.value();
  return configured === '' ? modelForTier('flash') : configured;
}

/** Modello di riserva di refineChapter ('' = nessuna riserva). */
export function refineFallbackModelName(): string {
  return geminiModelRefineFallback.value();
}
