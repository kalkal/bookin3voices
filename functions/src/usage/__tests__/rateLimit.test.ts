// Unit test del tetto d'uso. La verità sul comportamento
// TRANSAZIONALE (concorrenza reale) sta nell'integrazione contro l'emulatore
// (src/__integration__/usageLimit.test.ts); qui si valida la LOGICA di
// decisione (soglie per-uid/globale, separazione per azione e per giorno,
// conteggio dei soli usi consentiti) con un finto Firestore in memoria —
// l'emulatore su questa macchina è bloccato dal problema di loopback (vedi
// memoria toolchain), quindi il freno automatico locale passa da qui.

import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

import {
  DEFAULT_USAGE_LIMITS,
  enforceUsageLimit,
  usageDayKey,
  type UsageAction,
  type UsageLimit,
} from '../rateLimit';

// ---- finto Firestore: solo ciò che enforceUsageLimit usa (doc/collection,
//      runTransaction con tx.get/tx.set e merge). Le transazioni girano in
//      serie: basta per la logica, non per la concorrenza (→ integrazione). ----

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
  it('è la data UTC YYYY-MM-DD dell’istante', () => {
    expect(usageDayKey(NOW)).toBe(new Date(NOW).toISOString().slice(0, 10));
    expect(usageDayKey(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('enforceUsageLimit', () => {
  it('consente fino al tetto per-uid, poi resource-exhausted', async () => {
    const { db, store } = makeDb();
    const opts = { db, uid: 'u1', action: 'refineChapter' as const, now: () => NOW };
    const lim = limits({ refineChapter: { perUserPerDay: 3, globalPerDay: 1000 } });

    await enforceUsageLimit({ ...opts, limits: lim });
    await enforceUsageLimit({ ...opts, limits: lim });
    await enforceUsageLimit({ ...opts, limits: lim });
    await expect(enforceUsageLimit({ ...opts, limits: lim })).rejects.toBeInstanceOf(HttpsError);

    // il tentativo bloccato NON incrementa: il contatore resta al tetto
    const day = usageDayKey(NOW);
    expect(store.get(`usageDaily/${day}__refineChapter/users/u1`)).toMatchObject({ count: 3 });
  });

  it('resource-exhausted porta il codice giusto', async () => {
    const { db } = makeDb();
    const lim = limits({ refineChapter: { perUserPerDay: 1, globalPerDay: 1000 } });
    const opts = { db, uid: 'u1', action: 'refineChapter' as const, now: () => NOW, limits: lim };
    await enforceUsageLimit(opts);
    await expect(enforceUsageLimit(opts)).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('il tetto globale blocca un secondo uid ancora sotto il proprio limite', async () => {
    const { db } = makeDb();
    const lim = limits({ generateOutline: { perUserPerDay: 100, globalPerDay: 2 } });
    const base = { db, action: 'generateOutline' as const, now: () => NOW, limits: lim };

    await enforceUsageLimit({ ...base, uid: 'a' });
    await enforceUsageLimit({ ...base, uid: 'b' });
    await expect(enforceUsageLimit({ ...base, uid: 'c' })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('contatori separati per azione', async () => {
    const { db } = makeDb();
    const lim = limits({
      refineChapter: { perUserPerDay: 1, globalPerDay: 1000 },
      generateOutline: { perUserPerDay: 1, globalPerDay: 1000 },
    });
    const base = { db, uid: 'u1', now: () => NOW, limits: lim };

    await enforceUsageLimit({ ...base, action: 'refineChapter' });
    // outline ha il suo contatore: non è toccato dallo slot di refine
    await enforceUsageLimit({ ...base, action: 'generateOutline' });
    await expect(enforceUsageLimit({ ...base, action: 'refineChapter' })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('contatori separati per giorno (UTC): il giorno dopo si riparte', async () => {
    const { db } = makeDb();
    const lim = limits({ refineChapter: { perUserPerDay: 1, globalPerDay: 1000 } });
    const domani = NOW + 24 * 60 * 60 * 1000;

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
      enforceUsageLimit({ db, uid: 'u1', action: 'refineChapter', now: () => domani, limits: lim }),
    ).resolves.toBeUndefined();
  });

  it('un contatore ESISTENTE ma corrotto blocca (fail-closed), NON si azzera', async () => {
    const { db, store } = makeDb();
    const day = usageDayKey(NOW);
    // count non numerico su un doc esistente: non deve essere letto come 0 e
    // ripartire da 1 (sbloccherebbe il tetto), ma bloccare per prudenza — anche
    // con un limite ben POSITIVO (lo scenario preoccupante: es. 480/500 corrotto)
    store.set(`usageDaily/${day}__refineChapter/users/u1`, { count: 'rotto' });
    const lim = limits({ refineChapter: { perUserPerDay: 500, globalPerDay: 1000 } });

    await expect(
      enforceUsageLimit({ db, uid: 'u1', action: 'refineChapter', now: () => NOW, limits: lim }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    // il doc corrotto NON è stato sovrascritto a 1 (nessuna scrittura in blocco)
    expect(store.get(`usageDaily/${day}__refineChapter/users/u1`)).toEqual({ count: 'rotto' });
  });

  it('un contatore GLOBALE corrotto blocca a prescindere dall’uid', async () => {
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

  it('senza override usa i default espliciti', async () => {
    const { db, store } = makeDb();
    await enforceUsageLimit({ db, uid: 'u1', action: 'refineChapter', now: () => NOW });
    const day = usageDayKey(NOW);
    expect(store.get(`usageDaily/${day}__refineChapter/users/u1`)).toMatchObject({ count: 1 });
    expect(DEFAULT_USAGE_LIMITS.refineChapter.perUserPerDay).toBeGreaterThan(0);
  });
});
