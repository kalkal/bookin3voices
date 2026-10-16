// Integration test of the usage cap against the Firestore emulator
// (NEVER real projects). It verifies that:
//  - the per-uid counter blocks once the cap is reached (resource-exhausted);
//  - the global counter blocks regardless of uid (guard against many anonymous users);
//  - counters are separate per action (refine does not affect outline);
//  - counters are separate per day (UTC key);
//  - the transaction holds under concurrency (N parallel calls → never above the cap).

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import {
  DEFAULT_USAGE_LIMITS,
  enforceUsageLimit,
  usageDayKey,
  type UsageAction,
  type UsageLimit,
} from '../usage/rateLimit';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error('These tests run ONLY against the Firestore emulator (firebase emulators:exec).');
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-functions';
const NOW = 1757900000000; // 2025-09-15T... (fixed: stable day key)

let db: Firestore;
let uidCounter = 0;

function freshUid(): string {
  uidCounter += 1;
  return `utente-usage-${uidCounter}`;
}

const limits = (
  partial: Partial<Record<UsageAction, UsageLimit>>,
): Record<UsageAction, UsageLimit> => ({ ...DEFAULT_USAGE_LIMITS, ...partial });

function enforce(
  uid: string,
  action: UsageAction,
  overrides: Record<UsageAction, UsageLimit>,
  nowMs = NOW,
): Promise<void> {
  return enforceUsageLimit({ db, uid, action, now: () => nowMs, limits: overrides });
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  db = getFirestore();
});

describe('enforceUsageLimit (Firestore emulator)', () => {
  it('day key in UTC, stable for the same instant', () => {
    expect(usageDayKey(NOW)).toBe(new Date(NOW).toISOString().slice(0, 10));
    expect(usageDayKey(NOW)).toHaveLength(10);
  });

  it('per-uid: allows up to the cap, then resource-exhausted', async () => {
    const uid = freshUid();
    const opts = limits({ refineChapter: { perUserPerDay: 3, globalPerDay: 1000 } });

    await enforce(uid, 'refineChapter', opts);
    await enforce(uid, 'refineChapter', opts);
    await enforce(uid, 'refineChapter', opts);
    await expect(enforce(uid, 'refineChapter', opts)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });

    const day = usageDayKey(NOW);
    const userSnap = await db.doc(`usageDaily/${day}__refineChapter/users/${uid}`).get();
    expect(userSnap.get('count')).toBe(3); // the blocked call does not increment
  });

  it('global: another uid is blocked by the overall cap', async () => {
    const a = freshUid();
    const b = freshUid();
    const opts = limits({ generateOutline: { perUserPerDay: 100, globalPerDay: 2 } });

    await enforce(a, 'generateOutline', opts);
    await enforce(b, 'generateOutline', opts);
    // global cap = 2 reached: a third uid, even under its own cap, is out
    await expect(enforce(freshUid(), 'generateOutline', opts)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('counters are separate per action', async () => {
    const uid = freshUid();
    const opts = limits({
      refineChapter: { perUserPerDay: 1, globalPerDay: 1000 },
      generateOutline: { perUserPerDay: 1, globalPerDay: 1000 },
    });

    await enforce(uid, 'refineChapter', opts);
    // outline has its own counter: not affected by the refine just spent
    await enforce(uid, 'generateOutline', opts);

    await expect(enforce(uid, 'refineChapter', opts)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('counters are separate per day (UTC)', async () => {
    const uid = freshUid();
    const opts = limits({ refineChapter: { perUserPerDay: 1, globalPerDay: 1000 } });
    const domani = NOW + 24 * 60 * 60 * 1000;

    await enforce(uid, 'refineChapter', opts, NOW);
    await expect(enforce(uid, 'refineChapter', opts, NOW)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    // the next day the counter restarts
    await expect(enforce(uid, 'refineChapter', opts, domani)).resolves.toBeUndefined();
  });

  it('concurrency: 10 parallel calls do not exceed the cap', async () => {
    const uid = freshUid();
    const opts = limits({ refineChapter: { perUserPerDay: 4, globalPerDay: 1000 } });

    const esiti = await Promise.allSettled(
      Array.from({ length: 10 }, () => enforce(uid, 'refineChapter', opts)),
    );
    const ok = esiti.filter((e) => e.status === 'fulfilled').length;
    expect(ok).toBe(4);

    const day = usageDayKey(NOW);
    const userSnap = await db.doc(`usageDaily/${day}__refineChapter/users/${uid}`).get();
    expect(userSnap.get('count')).toBe(4);
  });
});
