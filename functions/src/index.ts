import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';

import { debugTraceEnabled } from './ai/debugTrace';
import { createGenerateOutlineHandler } from './ai/generateOutline';
import { createProvider, selectProviderName, type ModelRole } from './ai/provider/factory';
import { ProviderModel } from './ai/provider/ProviderModel';
import { REFINE_TEMPERATURE } from './ai/refinePrompt';
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

// AWS credentials for Amazon Bedrock (Amazon Nova, the only provider). Standard
// names so the AWS SDK picks them up from the environment. Grant the IAM user
// only bedrock:InvokeModel on the chosen model (README, "AI provider").
const awsAccessKeyId = defineSecret('AWS_ACCESS_KEY_ID');
const awsSecretAccessKey = defineSecret('AWS_SECRET_ACCESS_KEY');
const aiSecrets = [awsAccessKeyId, awsSecretAccessKey];

const providerDeps = { env: process.env };

/** A model bound to one role; the provider is resolved lazily, at request time. */
const modelFor = (role: ModelRole, temperature: number) =>
  new ProviderModel(() => createProvider(providerDeps, role), temperature);

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
// independent of Firebase and of the AI provider. Above the callable response cap the Storage
// variant is needed.
export const exportBackup = onCall(
  { memory: '512MiB', timeoutSeconds: 120 },
  withDemoAccess(getFirestore(), demoGate, createExportBackupHandler({ db: getFirestore() })),
);

// Chapter outline from the synopsis: the outline model (BEDROCK_MODEL_ID_OUTLINE,
// ai/provider/factory.ts) with Zod-validated structured output. The callable returns
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
// idempotency, dedup of pending ones. Model from config (BEDROCK_MODEL_ID,
// fallback BEDROCK_MODEL_ID_FALLBACK): every change must be replayed on the
// golden set (npm run golden).
export const refineChapter = onCall(
  { secrets: aiSecrets, timeoutSeconds: 300, memory: '512MiB' },
  createRefineChapterHandler({
    db: getFirestore(),
    defaultProvider: selectProviderName(process.env),
    providers: {
      bedrock: {
        primary: modelFor('primary', REFINE_TEMPERATURE),
        fallback: modelFor('fallback', REFINE_TEMPERATURE),
      },
    },
    // history check: two short calls on the primary model, in parallel with the refinement
    history: {
      bedrock: () => createProvider(providerDeps, 'primary'),
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
