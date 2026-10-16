// Test d'integrazione del tetto d'uso contro l'emulatore Firestore
// (MAI progetti reali). Si verifica che:
//  - il contatore per-uid blocca al raggiungimento del tetto (resource-exhausted);
//  - il contatore globale blocca a prescindere dall'uid (argine ai molti anonimi);
//  - i contatori sono separati per azione (refine non intacca outline);
//  - i contatori sono separati per giorno (chiave UTC);
//  - la transazione tiene sotto concorrenza (N chiamate parallele → mai oltre il tetto).

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
  throw new Error(
    'Questi test girano SOLO contro l’emulatore Firestore (firebase emulators:exec).',
  );
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-functions';
const NOW = 1757900000000; // 2025-09-15T... (fisso: chiave-giorno stabile)

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

describe('enforceUsageLimit (emulatore Firestore)', () => {
  it('chiave-giorno in UTC, stabile per lo stesso istante', () => {
    expect(usageDayKey(NOW)).toBe(new Date(NOW).toISOString().slice(0, 10));
    expect(usageDayKey(NOW)).toHaveLength(10);
  });

  it('per-uid: consente fino al tetto, poi resource-exhausted', async () => {
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
    expect(userSnap.get('count')).toBe(3); // la chiamata bloccata non incrementa
  });

  it('globale: un secondo uid viene bloccato dal tetto complessivo', async () => {
    const a = freshUid();
    const b = freshUid();
    const opts = limits({ generateOutline: { perUserPerDay: 100, globalPerDay: 2 } });

    await enforce(a, 'generateOutline', opts);
    await enforce(b, 'generateOutline', opts);
    // tetto globale = 2 raggiunto: un terzo uid, pur sotto il proprio tetto, è fuori
    await expect(enforce(freshUid(), 'generateOutline', opts)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('contatori separati per azione', async () => {
    const uid = freshUid();
    const opts = limits({
      refineChapter: { perUserPerDay: 1, globalPerDay: 1000 },
      generateOutline: { perUserPerDay: 1, globalPerDay: 1000 },
    });

    await enforce(uid, 'refineChapter', opts);
    // outline ha il suo contatore: non è intaccato dal refine appena speso
    await enforce(uid, 'generateOutline', opts);

    await expect(enforce(uid, 'refineChapter', opts)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('contatori separati per giorno (UTC)', async () => {
    const uid = freshUid();
    const opts = limits({ refineChapter: { perUserPerDay: 1, globalPerDay: 1000 } });
    const domani = NOW + 24 * 60 * 60 * 1000;

    await enforce(uid, 'refineChapter', opts, NOW);
    await expect(enforce(uid, 'refineChapter', opts, NOW)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    // il giorno dopo il contatore riparte
    await expect(enforce(uid, 'refineChapter', opts, domani)).resolves.toBeUndefined();
  });

  it('concorrenza: 10 chiamate parallele non superano il tetto', async () => {
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
