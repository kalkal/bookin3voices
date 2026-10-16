import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { createGenerateOutlineHandler } from './ai/generateOutline';
import { createProvider, selectProviderName, type ModelRole } from './ai/provider/factory';
import { ProviderModel } from './ai/provider/ProviderModel';
import type { AiProviderName } from './ai/provider/types';
import { REFINE_TEMPERATURE } from './ai/refinePrompt';
import { modelForTier, OUTLINE_TIER, refineFallbackModelName, refineModelName } from './ai/models';
import { createRefineChapterHandler } from './ai/refineChapter';
import { createExportBackupHandler } from './backup/exportBackup';
import { createExportBookHandler } from './export/exportBook';

if (getApps().length === 0) {
  initializeApp();
}

// Chiave Gemini: in locale arriva da functions/.secret.local (ignorato da git),
// in produzione da Secret Manager. Mai nel repo, mai nell'app.
const geminiApiKey = defineSecret('GEMINI_API_KEY');
// AWS credentials for Amazon Bedrock (default provider). Standard names so the
// AWS SDK picks them up from the environment. Grant the IAM user only
// bedrock:InvokeModel on the chosen model (README, "AI provider").
const awsAccessKeyId = defineSecret('AWS_ACCESS_KEY_ID');
const awsSecretAccessKey = defineSecret('AWS_SECRET_ACCESS_KEY');
const aiSecrets = [geminiApiKey, awsAccessKeyId, awsSecretAccessKey];

const providerDeps = {
  env: process.env,
  gemini: {
    model: (role: ModelRole) =>
      role === 'outline'
        ? modelForTier(OUTLINE_TIER)
        : role === 'fallback'
          ? refineFallbackModelName()
          : refineModelName(),
    apiKey: () => geminiApiKey.value(),
  },
};

/** A model bound to one role; the provider is resolved lazily, at request time. */
const modelFor = (role: ModelRole, temperature: number, name?: AiProviderName) =>
  new ProviderModel(() => createProvider(providerDeps, role, name), temperature);

export const ping = onCall(() => ({ ok: true }));

// Export EPUB/DOCX: il file torna al client in base64
// (MVP senza Storage). Un libro intero in base64 resta ampiamente sotto il
// limite di risposta delle callable; memoria abbondante per la generazione.
export const exportBook = onCall(
  { memory: '512MiB', timeoutSeconds: 120 },
  createExportBookHandler({ db: getFirestore() }),
);

// Backup Markdown del testo grezzo: zip in base64
// come per l'export — via d'uscita indipendente da Firebase/Gemini. Oltre il
// tetto della risposta callable serve la variante Storage.
export const exportBackup = onCall(
  { memory: '512MiB', timeoutSeconds: 120 },
  createExportBackupHandler({ db: getFirestore() }),
);

// Scaletta capitoli dalla sinossi (Fase 2): Gemini tier
// Pro (modello da config, ai/models.ts) con structured output validato Zod.
// La callable restituisce SOLO la proposta: la conferma e il merge additivo
// (mai toccare capitoli con testo) restano all'app.
export const generateOutline = onCall(
  { secrets: aiSecrets, timeoutSeconds: 300 },
  createGenerateOutlineHandler({
    db: getFirestore(),
    model: modelFor('outline', 0.7),
  }),
);

// Rifinitura del capitolo: Style Bible + few-shot +
// contesto (sinossi/outline) → suggerimenti puntuali validati, batch
// atomico su `suggestions`, idempotenza requestId, dedup dei pending.
// Modello da config (GEMINI_MODEL_REFINE, riserva GEMINI_MODEL_REFINE_FALLBACK):
// ogni cambio va rigiocato sul golden set (npm run golden).
export const refineChapter = onCall(
  { secrets: aiSecrets, timeoutSeconds: 300, memory: '512MiB' },
  createRefineChapterHandler({
    db: getFirestore(),
    defaultProvider: selectProviderName(process.env),
    providers: {
      bedrock: {
        primary: modelFor('primary', REFINE_TEMPERATURE, 'bedrock'),
        fallback: modelFor('fallback', REFINE_TEMPERATURE, 'bedrock'),
      },
      gemini: {
        primary: modelFor('primary', REFINE_TEMPERATURE, 'gemini'),
        fallback: modelFor('fallback', REFINE_TEMPERATURE, 'gemini'),
      },
    },
  }),
);

const geminiSmokeInput = z.object({
  // Solo testi fittizi: la chiave free è ammessa unicamente in sviluppo
  // con brani di prova inventati (regola di commutazione).
  text: z.string().min(1).max(2000),
});

const geminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

// Ping "la chiave Gemini raggiunge l'API?" con testo fittizio. Vive SOLO
// sull'emulatore (dev): in produzione sarebbe un endpoint PUBBLICO, senza auth
// né App Check, che consuma la chiave Gemini — buco di sicurezza. Il
// test della qualità della rifinitura NON passa da qui: golden set (npm run golden) e la
// callable refineChapter deployata. Sotto deploy FUNCTIONS_EMULATOR non è
// impostata, quindi l'export vale undefined e la funzione non viene deployata.
const geminiSmokeHandler = onCall({ secrets: [geminiApiKey] }, async (request) => {
  const parsed = geminiSmokeInput.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Atteso { text: string }');
  }

  // nome modello da config, tier Flash: basta per il fumo
  const model = modelForTier('flash');
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': geminiApiKey.value(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: parsed.data.text }] }],
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new HttpsError('internal', `Gemini HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const json = geminiResponseSchema.parse(await response.json());
  const reply = json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  return { ok: true, model, reply };
});

// Esportata SOLO sull'emulatore: in produzione resta undefined (non deployata).
export const geminiSmoke =
  process.env.FUNCTIONS_EMULATOR === 'true' ? geminiSmokeHandler : undefined;
