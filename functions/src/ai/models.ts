// Gemini model names per tier: the name lives in CONFIG, never hard-coded in
// the code; firebase-functions params can be overridden from .env/deploy
// without touching the code. Defaults (to be verified against the ListModels
// endpoint):
//  - flash: gemini-3.6-flash (default);
//  - pro:   gemini-3.1-pro-preview.
// The outline uses the PRO tier by default.

import { defineString } from 'firebase-functions/params';

export const AI_TIERS = ['flash', 'pro'] as const;
export type AiTier = (typeof AI_TIERS)[number];

const geminiModelFlash = defineString('GEMINI_MODEL_FLASH', {
  default: 'gemini-3.6-flash',
  description: 'Gemini model for the Flash tier (current refinements)',
});

const geminiModelPro = defineString('GEMINI_MODEL_PRO', {
  default: 'gemini-3.1-pro-preview',
  description: 'Gemini model for the Pro tier (outline and whole-chapter reviews)',
});

/** Model name per tier, resolved at runtime from config. */
export function modelForTier(tier: AiTier): string {
  return tier === 'pro' ? geminiModelPro.value() : geminiModelFlash.value();
}

/** Tier used by generateOutline (outline runs on the Pro tier). */
export const OUTLINE_TIER: AiTier = 'pro';

const geminiModelRefine = defineString('GEMINI_MODEL_REFINE', {
  default: '',
  description:
    'Chapter refinement model; empty = Flash tier. Every change must be replayed on the golden set (npm run golden).',
});

const geminiModelRefineFallback = defineString('GEMINI_MODEL_REFINE_FALLBACK', {
  default: 'gemini-3.6-flash',
  description:
    'Fallback model for refinement (used on 429/5xx from the primary); empty = no fallback.',
});

/** Primary model of refineChapter, resolved at runtime from config. */
export function refineModelName(): string {
  const configured = geminiModelRefine.value();
  return configured === '' ? modelForTier('flash') : configured;
}

/** Fallback model of refineChapter ('' = no fallback). */
export function refineFallbackModelName(): string {
  return geminiModelRefineFallback.value();
}
