// Tetto d'uso giornaliero per le callable che consumano Gemini (hardening). Con la config web pubblica (apiKey/appId nel profilo
// preview di eas.json) chiunque può fare signInAnonymously e martellare
// refineChapter/generateOutline: su chiave FREE brucia quota, su chiave a
// pagamento brucia soldi.
//
// App Check "vero" (Play Integrity) qui non è praticabile: l'app usa il
// Firebase JS SDK (non @react-native-firebase), che supporta solo reCAPTCHA
// (web) o un CustomProvider, e comunque l'APK è distribuito fuori dal Play
// Store (Play Integrity produrrebbe token solo via debug token). Scelta:
// mettere un limite lato server, per-uid e globale, contato PRIMA della
// chiamata al modello. Il tetto globale è la difesa dai molti uid anonimi; il
// budget alert GCP (da configurare nel proprio progetto) è la rete di sicurezza finale.
//
// Dati server-only: la collezione `usageDaily` è scritta solo dall'admin SDK
// (le Functions bypassano le rules) e, non essendo nello schema, resta
// negata ai client dalle security rules fail-closed (default deny).

import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

/** Azioni con tetto. Contatori separati per azione: un limite su refine (flash,
 *  frequente) non deve intaccare il budget di outline (Pro, caro ma raro). */
export const USAGE_ACTIONS = ['refineChapter', 'generateOutline'] as const;
export type UsageAction = (typeof USAGE_ACTIONS)[number];

export interface UsageLimit {
  /** Tetto giornaliero per singolo uid. */
  perUserPerDay: number;
  /** Tetto giornaliero complessivo (argine ai molti uid anonimi). */
  globalPerDay: number;
}

// Default calibrati su un'app mono-utente: abbondanti per un singolo utente, stretti per
// un attaccante. Il tetto globale è di fatto l'hard-cap di spesa: bloccando il
// NUMERO di chiamate/giorno (e la dimensione per chiamata è già limitata dai
// max-length Zod su testo/sinossi) limita in modo deterministico il costo/giorno.
// generateOutline usa il tier Pro (caro) → tetti più bassi del refine (flash).
// In produzione si ritoccano qui (un solo punto; il cambio richiede un redeploy).
export const DEFAULT_USAGE_LIMITS: Record<UsageAction, UsageLimit> = {
  refineChapter: { perUserPerDay: 200, globalPerDay: 300 },
  generateOutline: { perUserPerDay: 15, globalPerDay: 25 },
};

// Il contatore è dato interno, ma lo si rilegge con Zod al confine.
// Fail-closed: un documento ESISTENTE ma corrotto non deve "sbloccare" il tetto
// azzerandosi — si tratta come esaurito e si blocca (mai spendere di più per una
// forma inattesa). Un documento assente è invece il caso normale "ancora a zero".
const counterSchema = z.object({ count: z.number().int().nonnegative() });

/** Contatore corrente: 0 se il doc non esiste; se esiste ma è illeggibile, si
 *  blocca (fail-closed) invece di ripartire da zero. */
function readCounter(snap: { exists: boolean; data: () => unknown }): number {
  if (!snap.exists) return 0;
  const parsed = counterSchema.safeParse(snap.data());
  if (!parsed.success) {
    throw new HttpsError(
      'resource-exhausted',
      'Contatore d’uso non leggibile: operazione sospesa per prudenza. Riprova più tardi.',
    );
  }
  return parsed.data.count;
}

/**
 * Chiave-giorno in UTC (YYYY-MM-DD): deterministica e indipendente dal fuso del
 * server. Il reset del tetto è quindi a mezzanotte UTC — accettabile per un
 * limite anti-abuso, non è una quota contrattuale.
 */
export function usageDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export interface EnforceUsageOptions {
  db: Firestore;
  uid: string;
  action: UsageAction;
  /** Orologio iniettabile nei test; default Date.now. */
  now?: () => number;
  /** Tetti iniettabili nei test; default DEFAULT_USAGE_LIMITS. */
  limits?: Record<UsageAction, UsageLimit>;
}

/**
 * Conta un uso dell'azione e lo blocca se supera il tetto per-uid o globale.
 * Tutto in UNA transazione (legge i due contatori del giorno, verifica,
 * incrementa) così due chiamate concorrenti non superano il limite per corsa.
 *
 * Va invocata PRIMA della chiamata al modello e DOPO lo short-circuit di
 * idempotenza (requestId): un retry di rete riusa la risposta salvata e NON
 * deve consumare budget. Solleva `resource-exhausted` (429 lato client) al
 * raggiungimento del tetto, senza aver toccato Gemini.
 */
export async function enforceUsageLimit(options: EnforceUsageOptions): Promise<void> {
  const { db, uid, action, now = Date.now, limits = DEFAULT_USAGE_LIMITS } = options;
  const limit = limits[action];
  const day = usageDayKey(now());

  // usageDaily/{giorno__azione}                → contatore globale
  // usageDaily/{giorno__azione}/users/{uid}    → contatore per-uid
  const globalRef = db.doc(`usageDaily/${day}__${action}`);
  const userRef = globalRef.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    // tutte le letture prima di qualunque scrittura (vincolo delle transazioni)
    const [globalSnap, userSnap] = await Promise.all([tx.get(globalRef), tx.get(userRef)]);
    const globalCount = readCounter(globalSnap);
    const userCount = readCounter(userSnap);

    if (userCount >= limit.perUserPerDay) {
      throw new HttpsError(
        'resource-exhausted',
        `Limite giornaliero raggiunto per questa operazione (${limit.perUserPerDay}/giorno). Riprova domani.`,
      );
    }
    if (globalCount >= limit.globalPerDay) {
      throw new HttpsError(
        'resource-exhausted',
        'Servizio momentaneamente non disponibile per raggiunto limite d’uso complessivo. Riprova più tardi.',
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
