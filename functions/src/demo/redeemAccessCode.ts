// Callable `redeemAccessCode({ code })`: the judge types the code from the
// Devpost testing instructions once; the server remembers this phone's
// anonymous uid (demoAccess/{uid}) and from then on its AI calls pass the gate.
//
// Attempts are capped per phone and overall per day, counted BEFORE comparing,
// so guessing costs attempts whether right or wrong. The code is public in
// effect (anyone who reads the instructions has it): what protects the money
// is the caps, not the secrecy of the code.

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { enforceUsageLimit, usageDayKey } from '../usage/rateLimit';
import { accessCodeMatches, demoAccessPath, readOpenDemoConfig } from './demoGate';

/**
 * The only shape a code may have, checked before anything else (the app checks
 * the same): letters, digits, spaces and hyphens, 8 to 32 characters. SQL,
 * scripts, paths, nested JSON or emoji never get past this; the code is then
 * only hashed and compared, never used in a path, a query or a log.
 */
export const ACCESS_CODE_PATTERN = /^[A-Za-z0-9 -]{8,32}$/;

const redeemInputSchema = z.object({ code: z.string().trim().regex(ACCESS_CODE_PATTERN) }).strict();

export interface RedeemAccessCodeDeps {
  db: Firestore;
  /** DEMO_GATE=1: outside the demo there is nothing to redeem. */
  gateEnabled: boolean;
  /** Puts the judge claim on the account (admin SDK setCustomUserClaims). */
  setJudgeClaim: (uid: string) => Promise<void>;
  now?: () => number;
}

/**
 * The caller's address as Google's front end saw it. `rawRequest.ip` is the
 * LEFTMOST X-Forwarded-For entry (the framework trusts the proxy), which the
 * client can write itself; the front end appends the real address, so the
 * RIGHTMOST entry is the one a client cannot forge.
 */
export function callerAddress(request: {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
}): string | undefined {
  const header = request.headers?.['x-forwarded-for'];
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return forwarded.at(-1) ?? request.ip;
}

/** The eight 16-bit groups of an IPv6 address, «::» and a trailing dotted quad expanded. */
function ipv6Groups(ip: string): number[] {
  // a trailing IPv4 part (::ffff:192.0.2.7) becomes its two hex groups
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  const hex = dotted
    ? ip.slice(0, dotted.index) +
      [
        ((Number(dotted[1]) << 8) | Number(dotted[2])).toString(16),
        ((Number(dotted[3]) << 8) | Number(dotted[4])).toString(16),
      ].join(':')
    : ip;
  const [head = '', tail] = hex.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return groups.map((g) => parseInt(g, 16));
}

/** An IPv4 address written as IPv6 (::ffff:a.b.c.d, or in hex): back to IPv4. */
export function ipv4FromMapped(ip: string): string | undefined {
  if (isIP(ip) !== 6) return undefined;
  const g = ipv6Groups(ip);
  if (g.slice(0, 5).some((x) => x !== 0) || g[5] !== 0xffff) return undefined;
  const [hi = 0, lo = 0] = g.slice(6);
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

/** The first four groups of an IPv6 address (its /64), expanding «::». */
export function ipv6Network64(ip: string): string | undefined {
  if (isIP(ip) !== 6 || ipv4FromMapped(ip) !== undefined) return undefined;
  return ipv6Groups(ip)
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':');
}

/** The address as a counter key: hashed (no address stored), IPv6 cut to its /64. */
export function ipCounterKey(ip: string | undefined): string | undefined {
  if (ip === undefined || ip === '') return undefined;
  const network = ipv4FromMapped(ip) ?? ipv6Network64(ip) ?? ip;
  return `ip-${createHash('sha256').update(network).digest('hex').slice(0, 32)}`;
}

/** Every this many wrong codes in a day (all phones), the log raises an alarm. */
export const WRONG_CODE_ALARM_EVERY = 50;

/** Counts a wrong code in today's overall counter; returns the new count. */
async function countWrongCodeToday(db: Firestore, nowMs: number): Promise<number> {
  const ref = db.doc(`usageDaily/${usageDayKey(nowMs)}__redeemAccessCodeWrong`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.data() as { count?: unknown } | undefined)?.count;
    const next = (typeof current === 'number' ? current : 0) + 1;
    tx.set(ref, { schemaVersion: 1, count: next, updatedAt: nowMs }, { merge: true });
    return next;
  });
}

function tooManyAttempts(): HttpsError {
  return new HttpsError('resource-exhausted', 'Too many attempts today. Try again tomorrow.', {
    reason: 'too-many-attempts',
  });
}

/**
 * Gives back the attempt a RIGHT code reserved, in one transaction: right codes
 * never use up a phone's allowance. Never below zero.
 */
async function refundAttempt(db: Firestore, key: string, nowMs: number): Promise<void> {
  const ref = db.doc(`usageDaily/${usageDayKey(nowMs)}__redeemAccessCode/users/${key}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = (snap.data() as { count?: unknown } | undefined)?.count;
    if (typeof count === 'number' && count > 0) {
      tx.set(ref, { count: count - 1, updatedAt: nowMs }, { merge: true });
    }
  });
}

/** Reserves (counts) one attempt in a transaction; any cap reached becomes «too many attempts». */
async function countAttempt(
  db: Firestore,
  key: string,
  action: 'redeemAccessCode' | 'redeemAccessCodeIp',
  now: () => number,
): Promise<void> {
  try {
    await enforceUsageLimit({ db, uid: key, action, now });
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'resource-exhausted') throw tooManyAttempts();
    throw error;
  }
}

export async function runRedeemAccessCode(
  deps: RedeemAccessCodeDeps,
  uid: string,
  code: string,
  ip?: string,
): Promise<{ ok: true }> {
  const { db, now = Date.now } = deps;
  if (!deps.gateEnabled) {
    throw new HttpsError('failed-precondition', 'No access code is needed here.', {
      reason: 'demo-closed',
    });
  }
  const config = await readOpenDemoConfig(db, now());
  // per phone: the attempt is RESERVED first, in the same transaction that
  // refuses a phone at its cap (so parallel calls cannot try more codes than
  // the cap), then compared; a right code gives its slot back below, so in the
  // end only wrong codes count
  await countAttempt(db, uid, 'redeemAccessCode', now);
  if (!accessCodeMatches(code, config.codeSha256)) {
    // per network address, only WRONG codes count: a right code always passes,
    // even if many judges share one address (or the key is the front end's)
    const ipKey = ipCounterKey(ip);
    if (ipKey !== undefined) await countAttempt(db, ipKey, 'redeemAccessCodeIp', now);
    // no overall cap that could lock real judges out: an alarm in the log instead
    const wrongToday = await countWrongCodeToday(db, now());
    if (wrongToday % WRONG_CODE_ALARM_EVERY === 0) {
      logger.error('access-code-guessing-alarm', { wrongToday });
    }
    logger.warn('access-code-wrong', { uid, wrongToday, ipKey: ipKey ?? null });
    throw new HttpsError('permission-denied', 'Wrong access code.', { reason: 'wrong-code' });
  }
  await refundAttempt(db, uid, now());
  // idempotent: entering the code again only refreshes the marker
  await db.doc(demoAccessPath(uid)).set({
    schemaVersion: 1,
    codeSha256: config.codeSha256,
    grantedAt: now(),
  });
  await deps.setJudgeClaim(uid);
  logger.info('access-code-accepted', { uid });
  return { ok: true };
}

export function createRedeemAccessCodeHandler(
  deps: RedeemAccessCodeDeps,
): (request: CallableRequest<unknown>) => Promise<{ ok: true }> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) {
      throw new HttpsError('unauthenticated', 'Sign-in required.');
    }
    const parsed = redeemInputSchema.safeParse(request.data);
    if (!parsed.success) {
      // no echo of what was sent, not even its length
      throw new HttpsError('invalid-argument', 'The code has only letters, digits and hyphens.', {
        reason: 'invalid-code-format',
      });
    }
    return runRedeemAccessCode(
      deps,
      uid,
      parsed.data.code,
      callerAddress(request.rawRequest ?? {}),
    );
  };
}
