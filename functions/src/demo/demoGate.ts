// The contest judges' demo: a separate Firebase project where nothing on the
// server works without the access code (judge claim + server marker, checked
// by the rules and by every callable); without it the app shows only the
// bundled sample book, offline. Nova calls also follow the demo caps.
//
// The gate is switched on per deployment with DEMO_GATE=1 (functions/.env.<demo
// project id>), so the owner's own project and the emulators never see it.
// Everything that can change during judging lives in ONE server-only document,
// config/demo, read on every gated call: switching the demo off, changing the
// code or the caps needs no redeploy and takes effect on the next call.
//
// Server-only data: config/demo and demoAccess/{uid} are written only by the
// admin SDK (the owner edits config/demo in the Firebase console) and, not
// being in the rules, stay denied to clients (default deny).

import { createHash, timingSafeEqual } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import type { UsageAction, UsageLimit } from '../usage/rateLimit';

/** The gate is on only in the demo deployment. */
export function demoGateEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.DEMO_GATE === '1';
}

const limitSchema = z.object({
  perUserPerDay: z.number().int().nonnegative(),
  globalPerDay: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/**
 * config/demo. Every field is required: a document the owner half-filled must
 * close the demo, not open it with made-up values (fail-closed).
 */
export const demoConfigSchema = z.object({
  /** The kill switch: false = no new code, no AI call, for everyone, at once. */
  enabled: z.boolean(),
  /** sha256 (hex) of the normalized code: the code itself is never stored. */
  codeSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** After this instant (ms, UTC) the demo is closed: the end of judging. */
  expiresAt: z.number().int().positive(),
  /** Longest text one refine may send: a real chapter fits, a padded one does not. */
  maxTextChars: z.number().int().positive(),
  limits: z.object({
    refineChapter: limitSchema,
    generateOutline: limitSchema,
    refineTitle: limitSchema,
  }),
});
export type DemoConfig = z.infer<typeof demoConfigSchema>;

/**
 * The values proposed for judging (docs/judges-demo.md has the worst-case cost):
 * the owner pastes them into config/demo, with her own code hash.
 */
export const PROPOSED_DEMO_LIMITS: DemoConfig['limits'] = {
  refineChapter: { perUserPerDay: 15, globalPerDay: 40, total: 200 },
  generateOutline: { perUserPerDay: 2, globalPerDay: 5, total: 30 },
  refineTitle: { perUserPerDay: 10, globalPerDay: 30, total: 100 },
};
export const PROPOSED_MAX_TEXT_CHARS = 30_000;

function demoClosed(message: string): HttpsError {
  return new HttpsError('failed-precondition', message, { reason: 'demo-closed' });
}

/** Reads config/demo; missing, malformed, switched off or expired = closed. */
export async function readOpenDemoConfig(db: Firestore, nowMs: number): Promise<DemoConfig> {
  const snap = await db.doc('config/demo').get();
  const parsed = demoConfigSchema.safeParse(snap.exists ? snap.data() : undefined);
  if (!parsed.success) {
    // the owner must see this in the logs: the demo is closed by a bad document
    logger.error('demo-config-invalid', { exists: snap.exists });
    throw demoClosed('The demo is not available at the moment.');
  }
  const config = parsed.data;
  if (!config.enabled) throw demoClosed('The demo has been switched off.');
  if (nowMs >= config.expiresAt) throw demoClosed('The demo has ended.');
  return config;
}

/** Lower case, single spaces, no separators: «Tide-Lamp 4417» = «tide lamp 4417». */
export function normalizeAccessCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[\s\-_.]+/g, ' ')
    .trim();
}

export function accessCodeSha256(code: string): string {
  return createHash('sha256').update(normalizeAccessCode(code)).digest('hex');
}

/** Constant-time comparison of the typed code with the stored hash. */
export function accessCodeMatches(code: string, expectedSha256: string): boolean {
  const actual = Buffer.from(accessCodeSha256(code), 'hex');
  const expected = Buffer.from(expectedSha256, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The phone (its anonymous uid) entered a valid code: server-only marker. */
export const demoAccessPath = (uid: string) => `demoAccess/${uid}`;

/**
 * The custom claim redeemAccessCode puts on the phone's account. The rules
 * (firestore.demo.rules, storage.demo.rules) require it for any read or write.
 */
export const JUDGE_CLAIM = 'judge';

/** The caller's ID token claims, as the callable request carries them. */
export type CallerClaims = Record<string, unknown> | undefined;

/**
 * For any call in the demo: the demo must be open, the caller's token must
 * carry the judge claim and this phone must have entered the CURRENT code.
 * Returns the config, whose caps and text limit then apply. Checked on every
 * call, so a switch-off or a code change is immediate (the claim alone would
 * last until the token expires, up to an hour).
 */
export async function requireDemoAccess(
  db: Firestore,
  uid: string,
  claims: CallerClaims,
  nowMs: number,
): Promise<DemoConfig> {
  const config = await readOpenDemoConfig(db, nowMs);
  const access = await db.doc(demoAccessPath(uid)).get();
  const grantedHash = (access.data() as { codeSha256?: unknown } | undefined)?.codeSha256;
  // a phone that entered an OLD code must enter the new one
  if (claims?.[JUDGE_CLAIM] !== true || !access.exists || grantedHash !== config.codeSha256) {
    throw new HttpsError('permission-denied', 'An access code is required for the AI features.', {
      reason: 'access-code-required',
    });
  }
  return config;
}

/** The demo caps in the shape the usage limiter takes. */
export function demoUsageLimits(config: DemoConfig): Partial<Record<UsageAction, UsageLimit>> {
  return {
    refineChapter: config.limits.refineChapter,
    generateOutline: config.limits.generateOutline,
    refineTitle: config.limits.refineTitle,
  };
}

/** A refine text over the demo's limit is refused before any model call. */
export function assertDemoTextFits(text: string, config: DemoConfig): void {
  if (text.length > config.maxTextChars) {
    throw new HttpsError(
      'invalid-argument',
      `Text too long for the demo (max ${config.maxTextChars} characters).`,
      { reason: 'text-too-long', maxChars: config.maxTextChars },
    );
  }
}

/**
 * Wraps a callable that spends nothing on Nova (exports, backup): in the demo
 * it still needs the judge claim and an open demo, like everything else.
 */
export function withDemoAccess<T>(
  db: Firestore,
  enabled: boolean,
  handler: (request: CallableRequest<unknown>) => Promise<T>,
): (request: CallableRequest<unknown>) => Promise<T> {
  if (!enabled) return handler;
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) throw new HttpsError('unauthenticated', 'Sign-in required.');
    await requireDemoAccess(db, uid, request.auth?.token, Date.now());
    return handler(request);
  };
}
