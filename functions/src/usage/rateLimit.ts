// Daily usage cap for the callables that consume Gemini (hardening). With the
// public web config (apiKey/appId in the preview profile of eas.json) anyone
// can signInAnonymously and hammer refineChapter/generateOutline: on a FREE key
// that burns quota, on a paid key it burns money.
//
// Real App Check (Play Integrity) is not practical here: the app uses the
// Firebase JS SDK (not @react-native-firebase), which only supports reCAPTCHA
// (web) or a CustomProvider, and the APK is distributed outside the Play Store
// anyway (Play Integrity would only yield tokens via a debug token). Choice:
// a server-side limit, per uid and global, counted BEFORE the model call. The
// global cap is the defense against many anonymous uids; the GCP budget alert
// (to be configured in your own project) is the final safety net.
//
// Server-only data: the `usageDaily` collection is written only by the admin
// SDK (Functions bypass the rules) and, not being in the schema, stays denied
// to clients by the fail-closed security rules (default deny).

import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

/** Actions with a cap. Separate counters per action: a limit on refine (flash,
 *  frequent) must not eat into the outline budget (Pro, expensive but rare). */
export const USAGE_ACTIONS = ['refineChapter', 'generateOutline', 'refineTitle'] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

export interface UsageLimit {
  /** Daily cap per single uid. */
  perUserPerDay: number;
  /** Overall daily cap (guards against many anonymous uids). */
  globalPerDay: number;
}

// Defaults calibrated for a single-user app: generous for one user, tight for
// an attacker. The global cap is in effect the spending hard-cap: by limiting
// the NUMBER of calls/day (and the size per call is already bounded by the Zod
// max-lengths on text/synopsis) it deterministically bounds the cost/day.
// generateOutline uses the Pro tier (expensive) -> lower caps than refine
// (flash). In production adjust them here (single place; a change requires a
// redeploy).
export const DEFAULT_USAGE_LIMITS: Record<UsageAction, UsageLimit> = {
  refineChapter: { perUserPerDay: 200, globalPerDay: 300 },
  generateOutline: { perUserPerDay: 15, globalPerDay: 25 },
  // a short call (title + excerpt), but still a model call
  refineTitle: { perUserPerDay: 100, globalPerDay: 200 },
};

// The counter is internal data, but it is re-read with Zod at the boundary.
// Fail-closed: an EXISTING but corrupted document must not "unlock" the cap by
// resetting itself - it is treated as exhausted and blocks (never spend more
// because of an unexpected shape). A missing document is instead the normal
// "still at zero" case.
const counterSchema = z.object({ count: z.number().int().nonnegative() });

/** Current counter: 0 if the doc does not exist; if it exists but is
 *  unreadable, it blocks (fail-closed) instead of restarting from zero. */
function readCounter(snap: { exists: boolean; data: () => unknown }): number {
  if (!snap.exists) return 0;
  const parsed = counterSchema.safeParse(snap.data());
  if (!parsed.success) {
    throw new HttpsError(
      'resource-exhausted',
      'Usage counter unreadable: operation suspended as a precaution. Try again later.',
    );
  }
  return parsed.data.count;
}

/**
 * Day key in UTC (YYYY-MM-DD): deterministic and independent of the server
 * timezone. The cap therefore resets at midnight UTC - acceptable for an
 * anti-abuse limit, it is not a contractual quota.
 */
export function usageDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export interface EnforceUsageOptions {
  db: Firestore;
  uid: string;
  action: UsageAction;
  /** Clock, injectable in tests; defaults to Date.now. */
  now?: () => number;
  /** Limits, injectable in tests; default DEFAULT_USAGE_LIMITS. */
  limits?: Record<UsageAction, UsageLimit>;
}

/**
 * Counts one use of the action and blocks it if it exceeds the per-uid or
 * global cap. Everything runs in ONE transaction (reads the two daily
 * counters, checks, increments) so two concurrent calls cannot exceed the
 * limit through a race.
 *
 * Must be invoked BEFORE the model call and AFTER the idempotency
 * short-circuit (requestId): a network retry reuses the saved response and
 * must NOT consume budget. Throws `resource-exhausted` (429 on the client side)
 * when the cap is reached, without having touched Gemini.
 */
export async function enforceUsageLimit(options: EnforceUsageOptions): Promise<void> {
  const { db, uid, action, now = Date.now, limits = DEFAULT_USAGE_LIMITS } = options;
  const limit = limits[action];
  const day = usageDayKey(now());

  // usageDaily/{day__action}                -> global counter
  // usageDaily/{day__action}/users/{uid}    -> per-uid counter
  const globalRef = db.doc(`usageDaily/${day}__${action}`);
  const userRef = globalRef.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    // all reads before any write (transaction constraint)
    const [globalSnap, userSnap] = await Promise.all([tx.get(globalRef), tx.get(userRef)]);
    const globalCount = readCounter(globalSnap);
    const userCount = readCounter(userSnap);

    if (userCount >= limit.perUserPerDay) {
      throw new HttpsError(
        'resource-exhausted',
        `Daily limit reached for this operation (${limit.perUserPerDay}/day). Try again tomorrow.`,
      );
    }
    if (globalCount >= limit.globalPerDay) {
      throw new HttpsError(
        'resource-exhausted',
        'Service temporarily unavailable: the overall usage limit has been reached. Try again later.',
      );
    }

    const stamp = now();
    tx.set(
      globalRef,
      { schemaVersion: 1, action, count: globalCount + 1, updatedAt: stamp },
      { merge: true },
    );
    tx.set(userRef, { schemaVersion: 1, count: userCount + 1, updatedAt: stamp }, { merge: true });
  });
}
