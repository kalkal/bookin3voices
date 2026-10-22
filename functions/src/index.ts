import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { debugTraceEnabled } from './ai/debugTrace';
import { createGenerateOutlineHandler } from './ai/generateOutline';
import { createProvider, selectProviderName, type ModelRole } from './ai/provider/factory';
import { ProviderModel } from './ai/provider/ProviderModel';
import type { AiProviderName } from './ai/provider/types';
import { REFINE_TEMPERATURE } from './ai/refinePrompt';
import { modelForTier, OUTLINE_TIER, refineFallbackModelName, refineModelName } from './ai/models';
import { createRefineChapterHandler } from './ai/refineChapter';
import { createRefineTitleHandler } from './ai/refineTitle';
import { createExportBackupHandler } from './backup/exportBackup';
import { demoGateEnabled, JUDGE_CLAIM, withDemoAccess } from './demo/demoGate';
import { createRedeemAccessCodeHandler } from './demo/redeemAccessCode';
import { createExportBookHandler } from './export/exportBook';

if (getApps().length === 0) {
  initializeApp();
}

// Judges' demo (DEMO_GATE=1 in functions/.env.<demo project id>): the Nova calls
// need the access code and follow the caps in config/demo (demo/demoGate.ts).
const demoGate = demoGateEnabled(process.env);
// App Check switch, OFF by default (docs/judges-demo.md): the app runs the
// Firebase JS SDK, which has no Play Integrity provider on Android, so turning
// it on needs the native App Check module in the app first.
const enforceAppCheck = process.env.ENFORCE_APP_CHECK === '1';
setGlobalOptions({
  // few instances in the demo: abuse cannot multiply the Google Cloud side of the bill
  ...(demoGate ? { maxInstances: 3 } : {}),
  ...(enforceAppCheck ? { enforceAppCheck: true } : {}),
});

// Gemini key: locally it comes from functions/.secret.local (git-ignored), in
// production from Secret Manager. Never in the repo, never in the app.
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

// The judge's access code, once per phone (demo only; elsewhere it answers
// demo-closed). No AI secret: it spends nothing.
export const redeemAccessCode = onCall(
  createRedeemAccessCodeHandler({
    db: getFirestore(),
    gateEnabled: demoGate,
    setJudgeClaim: (uid) => getAuth().setCustomUserClaims(uid, { [JUDGE_CLAIM]: true }),
  }),
);

// EPUB/DOCX export: the file is returned to the client as base64 (MVP without
// Storage). A whole book in base64 stays well under the callable response
// limit; generous memory for generation.
export const exportBook = onCall(
  { memory: '512MiB', timeoutSeconds: 120 },
  withDemoAccess(getFirestore(), demoGate, createExportBookHandler({ db: getFirestore() })),
);

// Markdown backup of the raw text: base64 zip as for export - exit route
// independent of Firebase/Gemini. Above the callable response cap the Storage
// variant is needed.
export const exportBackup = onCall(
  { memory: '512MiB', timeoutSeconds: 120 },
  withDemoAccess(getFirestore(), demoGate, createExportBackupHandler({ db: getFirestore() })),
);

// Chapter outline from the synopsis: Gemini Pro tier (model from config,
// ai/models.ts) with Zod-validated structured output. The callable returns
// ONLY the proposal: confirmation and the additive merge (never touching
// chapters that have text) stay with the app.
export const generateOutline = onCall(
  { secrets: aiSecrets, timeoutSeconds: 300 },
  createGenerateOutlineHandler({
    db: getFirestore(),
    model: modelFor('outline', 0.7),
    demoGate,
  }),
);

// Chapter refinement: Style Bible + few-shot + context (synopsis/outline) ->
// validated pinpoint suggestions, atomic batch on `suggestions`, requestId
// idempotency, dedup of pending ones. Model from config (GEMINI_MODEL_REFINE,
// fallback GEMINI_MODEL_REFINE_FALLBACK): every change must be replayed on the
// golden set (npm run golden).
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
    // history check: two short calls on the primary model, in parallel with the refinement
    history: {
      bedrock: () => createProvider(providerDeps, 'primary', 'bedrock'),
      gemini: () => createProvider(providerDeps, 'primary', 'gemini'),
    },
    // dev-only debug trace for the app's test log: off unless DEBUG_TRACE=1 or emulator
    debugTrace: debugTraceEnabled(process.env),
    demoGate,
  }),
);

// «Rifinisci il titolo»: up to 3 alternative chapter titles (the title is not in
// rawText, so it has its own small path). Nothing is stored server-side.
export const refineTitle = onCall(
  { secrets: aiSecrets, timeoutSeconds: 120 },
  createRefineTitleHandler({
    db: getFirestore(),
    model: modelFor('primary', 0.7),
    demoGate,
  }),
);

const geminiSmokeInput = z.object({
  // Fictitious text only: the free key is allowed solely in development with
  // invented sample passages (switching rule).
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

// Ping "does the Gemini key reach the API?" with fictitious text. Lives ONLY
// on the emulator (dev): in production it would be a PUBLIC endpoint, with no
// auth or App Check, consuming the Gemini key - a security hole. Refinement
// quality testing does NOT go through here: golden set (npm run golden) and the
// deployed refineChapter callable. Under deploy FUNCTIONS_EMULATOR is not set,
// so the export is undefined and the function is not deployed.
const geminiSmokeHandler = onCall({ secrets: [geminiApiKey] }, async (request) => {
  const parsed = geminiSmokeInput.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Expected { text: string }');
  }

  // model name from config, Flash tier: enough for a smoke test
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

// Exported ONLY on the emulator: in production it stays undefined (not deployed).
export const geminiSmoke =
  process.env.FUNCTIONS_EMULATOR === 'true' ? geminiSmokeHandler : undefined;
