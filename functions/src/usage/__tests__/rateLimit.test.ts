// Unit tests of the usage cap. The truth about TRANSACTIONAL behavior (real
// concurrency) lives in the integration test against the emulator
// (src/__integration__/usageLimit.test.ts); here the decision LOGIC is
// validated (per-uid/global thresholds, separation by action and by day,
// counting only allowed uses) with an in-memory fake Firestore.

import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

import {
  DEFAULT_USAGE_LIMITS,
  enforceUsageLimit,
  usageDayKey,
  type UsageAction,
  type UsageLimit,
} from '../rateLimit';

// ---- fake Firestore: only what enforceUsageLimit uses (doc/collection,
//      runTransaction with tx.get/tx.set and merge). Transactions run serially:
//      enough for the logic, not for concurrency (-> integration). ----

type Data = Record<string, unknown>;

class FakeDoc {
  constructor(
    readonly store: Map<string, Data>,
    readonly path: string,
  ) {}
  collection(name: string): FakeCollection {
    return new FakeCollection(this.store, `${this.path}/${name}`);
  }
}

class FakeCollection {
  constructor(
    readonly store: Map<string, Data>,
    readonly path: string,
  ) {}
  doc(id: string): FakeDoc {
    return new FakeDoc(this.store, `${this.path}/${id}`);
  }
}

class FakeTx {
  constructor(private readonly store: Map<string, Data>) {}
  async get(ref: FakeDoc): Promise<{ exists: boolean; data: () => Data | undefined }> {
    const data = this.store.get(ref.path);
    return { exists: data !== undefined, data: () => data };
  }
  set(ref: FakeDoc, data: Data, opts?: { merge?: boolean }): void {
    const base = opts?.merge === true ? (this.store.get(ref.path) ?? {}) : {};
    this.store.set(ref.path, { ...base, ...data });
  }
}

class FakeDb {
  readonly store = new Map<string, Data>();
  doc(path: string): FakeDoc {
    return new FakeDoc(this.store, path);
  }
  async runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    return fn(new FakeTx(this.store));
  }
}

const NOW = 1757900000000;

function makeDb(): { db: Firestore; store: Map<string, Data> } {
  const fake = new FakeDb();
  return { db: fake as unknown as Firestore, store: fake.store };
}

const limits = (
  partial: Partial<Record<UsageAction, UsageLimit>>,
): Record<UsageAction, UsageLimit> => ({ ...DEFAULT_USAGE_LIMITS, ...partial });

describe('usageDayKey', () => {
  it('is the UTC YYYY-MM-DD date of the instant', () => {
    expect(usageDayKey(NOW)).toBe(new Date(NOW).toISOString().slice(0, 10));
    expect(usageDayKey(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('enforceUsageLimit', () => {
  it('allows up to the per-uid cap, then resource-exhausted', async () => {
    const { db, store } = makeDb();
    const opts = { db, uid: 'u1', action: 'refineChapter' as const, now: () => NOW };
    const lim = limits({ refineChapter: { perUserPerDay: 3, globalPerDay: 1000 } });

    await enforceUsageLimit({ ...opts, limits: lim });
    await enforceUsageLimit({ ...opts, limits: lim });
    await enforceUsageLimit({ ...opts, limits: lim });
    await expect(enforceUsageLimit({ ...opts, limits: lim })).rejects.toBeInstanceOf(HttpsError);

    // the blocked attempt does NOT increment: the counter stays at the cap
    const day = usageDayKey(NOW);
    expect(store.get(`usageDaily/${day}__refineChapter/users/u1`)).toMatchObject({ count: 3 });
  });

  it('resource-exhausted carries the right code', async () => {
    const { db } = makeDb();
    const lim = limits({ refineChapter: { perUserPerDay: 1, globalPerDay: 1000 } });
    const opts = { db, uid: 'u1', action: 'refineChapter' as const, now: () => NOW, limits: lim };
    await enforceUsageLimit(opts);
    await expect(enforceUsageLimit(opts)).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('the global cap blocks another uid that is still under its own limit', async () => {
    const { db } = makeDb();
    const lim = limits({ generateOutline: { perUserPerDay: 100, globalPerDay: 2 } });
    const base = { db, action: 'generateOutline' as const, now: () => NOW, limits: lim };

    await enforceUsageLimit({ ...base, uid: 'a' });
    await enforceUsageLimit({ ...base, uid: 'b' });
    await expect(enforceUsageLimit({ ...base, uid: 'c' })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('separate counters per action', async () => {
    const { db } = makeDb();
    const lim = limits({
      refineChapter: { perUserPerDay: 1, globalPerDay: 1000 },
      generateOutline: { perUserPerDay: 1, globalPerDay: 1000 },
    });
    const base = { db, uid: 'u1', now: () => NOW, limits: lim };

    await enforceUsageLimit({ ...base, action: 'refineChapter' });
    // outline has its own counter: untouched by the refine slot
    await enforceUsageLimit({ ...base, action: 'generateOutline' });
    await expect(enforceUsageLimit({ ...base, action: 'refineChapter' })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('separate counters per day (UTC): the next day starts over', async () => {
    const { db } = makeDb();
    const lim = limits({ refineChapter: { perUserPerDay: 1, globalPerDay: 1000 } });
    const tomorrow = NOW + 24 * 60 * 60 * 1000;

    await enforceUsageLimit({
      db,
      uid: 'u1',
      action: 'refineChapter',
      now: () => NOW,
      limits: lim,
    });
    await expect(
      enforceUsageLimit({ db, uid: 'u1', action: 'refineChapter', now: () => NOW, limits: lim }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    await expect(
      enforceUsageLimit({
        db,
        uid: 'u1',
        action: 'refineChapter',
        now: () => tomorrow,
        limits: lim,
      }),
    ).resolves.toBeUndefined();
  });

  it('an EXISTING but corrupted counter blocks (fail-closed), it does NOT reset', async () => {
    const { db, store } = makeDb();
    const day = usageDayKey(NOW);
    // non-numeric count on an existing doc: it must not be read as 0 and
    // restart from 1 (that would unlock the cap), but block as a precaution -
    // even with a well POSITIVE limit (the worrying scenario: e.g. corrupted 480/500)
    store.set(`usageDaily/${day}__refineChapter/users/u1`, { count: 'rotto' });
    const lim = limits({ refineChapter: { perUserPerDay: 500, globalPerDay: 1000 } });

    await expect(
      enforceUsageLimit({ db, uid: 'u1', action: 'refineChapter', now: () => NOW, limits: lim }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    // the corrupted doc was NOT overwritten with 1 (no write when blocking)
    expect(store.get(`usageDaily/${day}__refineChapter/users/u1`)).toEqual({ count: 'rotto' });
  });

  it('a corrupted GLOBAL counter blocks regardless of the uid', async () => {
    const { db, store } = makeDb();
    const day = usageDayKey(NOW);
    store.set(`usageDaily/${day}__refineChapter`, { count: {} });
    const lim = limits({ refineChapter: { perUserPerDay: 500, globalPerDay: 1000 } });

    await expect(
      enforceUsageLimit({
        db,
        uid: 'u-nuovo',
        action: 'refineChapter',
        now: () => NOW,
        limits: lim,
      }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('without overrides it uses the explicit defaults', async () => {
    const { db, store } = makeDb();
    await enforceUsageLimit({ db, uid: 'u1', action: 'refineChapter', now: () => NOW });
    const day = usageDayKey(NOW);
    expect(store.get(`usageDaily/${day}__refineChapter/users/u1`)).toMatchObject({ count: 1 });
    expect(DEFAULT_USAGE_LIMITS.refineChapter.perUserPerDay).toBeGreaterThan(0);
  });
});
