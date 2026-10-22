// The judges' demo gate: config/demo fail-closed, the access code per phone,
// the demo caps (daily per phone, daily overall, total) with the reason the
// app shows, and the text limit. In-memory fake Firestore, transactions serial
// (the concurrency truth is the integration test of the usage limiter).

import type { Firestore } from 'firebase-admin/firestore';

import { enforceUsageLimit, nextUsageDayStart } from '../../usage/rateLimit';
import {
  accessCodeMatches,
  accessCodeSha256,
  assertDemoTextFits,
  demoAccessPath,
  demoUsageLimits,
  normalizeAccessCode,
  PROPOSED_DEMO_LIMITS,
  PROPOSED_MAX_TEXT_CHARS,
  readOpenDemoConfig,
  requireDemoAccess,
  type DemoConfig,
} from '../demoGate';
import { runRedeemAccessCode } from '../redeemAccessCode';

type Data = Record<string, unknown>;

class FakeDoc {
  constructor(
    readonly store: Map<string, Data>,
    readonly path: string,
  ) {}
  collection(name: string): FakeCollection {
    return new FakeCollection(this.store, `${this.path}/${name}`);
  }
  async get(): Promise<{ exists: boolean; data: () => Data | undefined }> {
    const data = this.store.get(this.path);
    return { exists: data !== undefined, data: () => data };
  }
  async set(data: Data): Promise<void> {
    this.store.set(this.path, { ...data });
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
  async get(ref: FakeDoc) {
    return ref.get();
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
  // transactions one after the other, as Firestore guarantees for the same documents
  private queue: Promise<unknown> = Promise.resolve();
  async runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => fn(new FakeTx(this.store)));
    this.queue = run.catch(() => undefined);
    return run;
  }
}

const NOW = Date.UTC(2026, 9, 23, 10, 0, 0);
const CODE = 'Tide-Lamp 4417';
const JUDGE = { judge: true };

function config(overrides: Partial<DemoConfig> = {}): DemoConfig {
  return {
    enabled: true,
    codeSha256: accessCodeSha256(CODE),
    expiresAt: Date.UTC(2026, 10, 21),
    maxTextChars: PROPOSED_MAX_TEXT_CHARS,
    limits: PROPOSED_DEMO_LIMITS,
    ...overrides,
  };
}

function makeDb(demo?: Data): { db: Firestore; store: Map<string, Data> } {
  const fake = new FakeDb();
  if (demo !== undefined) fake.store.set('config/demo', demo);
  return { db: fake as unknown as Firestore, store: fake.store };
}

describe('access code', () => {
  it('is compared normalized: case, spaces and separators do not matter', () => {
    expect(normalizeAccessCode('  TIDE_lamp.4417 ')).toBe('tide lamp 4417');
    expect(accessCodeMatches('tide lamp 4417', accessCodeSha256(CODE))).toBe(true);
    expect(accessCodeMatches('tide lamp 4418', accessCodeSha256(CODE))).toBe(false);
  });
});

describe('config/demo is fail-closed', () => {
  it.each([
    ['missing', undefined],
    ['half filled', { enabled: true }],
    ['switched off', config({ enabled: false })],
    ['expired', config({ expiresAt: NOW })],
  ])('%s → demo-closed', async (_label, doc) => {
    const { db } = makeDb(doc as Data | undefined);
    await expect(readOpenDemoConfig(db, NOW)).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { reason: 'demo-closed' },
    });
  });

  it('a complete, open document is returned', async () => {
    const { db } = makeDb(config());
    await expect(readOpenDemoConfig(db, NOW)).resolves.toMatchObject({ enabled: true });
  });
});

describe('redeemAccessCode', () => {
  const setJudgeClaim = jest.fn(async (uid: string) => void uid);
  const deps = (db: Firestore) => ({ db, gateEnabled: true, setJudgeClaim, now: () => NOW });
  beforeEach(() => setJudgeClaim.mockClear());

  it('the right code marks this phone; the AI gate then lets it through', async () => {
    const { db, store } = makeDb(config());
    await expect(requireDemoAccess(db, 'phone-1', JUDGE, NOW)).rejects.toMatchObject({
      code: 'permission-denied',
      details: { reason: 'access-code-required' },
    });
    await expect(runRedeemAccessCode(deps(db), 'phone-1', 'tide lamp 4417')).resolves.toEqual({
      ok: true,
    });
    expect(store.get(demoAccessPath('phone-1'))).toMatchObject({ grantedAt: NOW });
    await expect(requireDemoAccess(db, 'phone-1', JUDGE, NOW)).resolves.toMatchObject({
      enabled: true,
    });
    // another phone still needs the code
    await expect(requireDemoAccess(db, 'phone-2', JUDGE, NOW)).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('a wrong code is refused and marks nothing', async () => {
    const { db, store } = makeDb(config());
    await expect(runRedeemAccessCode(deps(db), 'phone-1', 'guess')).rejects.toMatchObject({
      code: 'permission-denied',
      details: { reason: 'wrong-code' },
    });
    expect(store.has(demoAccessPath('phone-1'))).toBe(false);
  });

  it('after 10 attempts in a day, even the right code waits for tomorrow', async () => {
    const { db } = makeDb(config());
    for (let i = 0; i < 10; i++) {
      await expect(runRedeemAccessCode(deps(db), 'phone-1', `guess ${i}`)).rejects.toMatchObject({
        details: { reason: 'wrong-code' },
      });
    }
    await expect(runRedeemAccessCode(deps(db), 'phone-1', CODE)).rejects.toMatchObject({
      code: 'resource-exhausted',
      details: { reason: 'too-many-attempts' },
    });
  });

  it('a new code in config/demo locks out phones that entered the old one', async () => {
    const { db, store } = makeDb(config());
    await runRedeemAccessCode(deps(db), 'phone-1', CODE);
    store.set('config/demo', config({ codeSha256: accessCodeSha256('new code 1') }));
    await expect(requireDemoAccess(db, 'phone-1', JUDGE, NOW)).rejects.toMatchObject({
      details: { reason: 'access-code-required' },
    });
  });

  it('switched off: neither the code nor the AI work, at once', async () => {
    const { db, store } = makeDb(config());
    await runRedeemAccessCode(deps(db), 'phone-1', CODE);
    store.set('config/demo', config({ enabled: false }));
    await expect(requireDemoAccess(db, 'phone-1', JUDGE, NOW)).rejects.toMatchObject({
      details: { reason: 'demo-closed' },
    });
    await expect(runRedeemAccessCode(deps(db), 'phone-2', CODE)).rejects.toMatchObject({
      details: { reason: 'demo-closed' },
    });
  });

  it('outside the demo deployment there is nothing to redeem', async () => {
    const { db } = makeDb(config());
    await expect(
      runRedeemAccessCode(
        { db, gateEnabled: false, setJudgeClaim: async () => {}, now: () => NOW },
        'phone-1',
        CODE,
      ),
    ).rejects.toMatchObject({ details: { reason: 'demo-closed' } });
  });
});

describe('demo caps', () => {
  const run = (db: Firestore, uid: string, limits = demoUsageLimits(config())) =>
    enforceUsageLimit({ db, uid, action: 'refineChapter', now: () => NOW, limits });

  it('per phone per day, with the reason and when it resets', async () => {
    const { db } = makeDb();
    for (let i = 0; i < PROPOSED_DEMO_LIMITS.refineChapter.perUserPerDay; i++) {
      await run(db, 'phone-1');
    }
    await expect(run(db, 'phone-1')).rejects.toMatchObject({
      code: 'resource-exhausted',
      details: { reason: 'limit-reached', scope: 'user', resetsAt: nextUsageDayStart(NOW) },
    });
    await expect(run(db, 'phone-2')).resolves.toBeUndefined();
  });

  it('the total cap holds across days and phones, and never resets', async () => {
    const { db, store } = makeDb();
    const limits = demoUsageLimits(
      config({
        limits: {
          ...PROPOSED_DEMO_LIMITS,
          refineChapter: { perUserPerDay: 100, globalPerDay: 100, total: 3 },
        },
      }),
    );
    await run(db, 'a', limits);
    await run(db, 'b', limits);
    await enforceUsageLimit({
      db,
      uid: 'c',
      action: 'refineChapter',
      now: () => NOW + 86_400_000,
      limits,
    });
    await expect(run(db, 'd', limits)).rejects.toMatchObject({
      details: { reason: 'limit-reached', scope: 'total' },
    });
    expect(store.get('usageTotal/refineChapter')).toMatchObject({ count: 3 });
  });

  it('a cap at 0 stops everyone at once', async () => {
    const { db } = makeDb();
    const limits = demoUsageLimits(
      config({
        limits: {
          ...PROPOSED_DEMO_LIMITS,
          refineChapter: { perUserPerDay: 15, globalPerDay: 0, total: 200 },
        },
      }),
    );
    await expect(run(db, 'a', limits)).rejects.toMatchObject({
      details: { reason: 'limit-reached', scope: 'global' },
    });
  });

  it('the text limit is refused with the maximum', () => {
    expect(() => assertDemoTextFits('x'.repeat(30_001), config())).toThrow(
      expect.objectContaining({
        code: 'invalid-argument',
        details: { reason: 'text-too-long', maxChars: 30_000 },
      }),
    );
    expect(() => assertDemoTextFits('x'.repeat(30_000), config())).not.toThrow();
  });
});

describe('the gated callables never reach the model without access', () => {
  const model = { modelName: 'fake', generate: jest.fn(async () => ({ suggestions: [] })) };
  const text = 'Una frase di prova per il capitolo di esempio.';

  beforeEach(() => model.generate.mockClear());

  it('refineChapter: no code → access-code-required, no model call, no usage counted', async () => {
    const { db, store } = makeDb(config());
    const { runRefineChapter } = await import('../../ai/refineChapter');
    const { textHash } = await import('../../ai/textHash');
    await expect(
      runRefineChapter(
        {
          db,
          demoGate: true,
          now: () => NOW,
          providers: { bedrock: { primary: model } },
        },
        'phone-1',
        { bookId: 'b', chapterId: 'c', text, textHash: textHash(text), requestId: 'r1' },
      ),
    ).rejects.toMatchObject({ details: { reason: 'access-code-required' } });
    expect(model.generate).not.toHaveBeenCalled();
    expect([...store.keys()].some((k) => k.startsWith('usage'))).toBe(false);
  });

  it('generateOutline: demo switched off → demo-closed, no model call', async () => {
    const { db } = makeDb(config({ enabled: false }));
    const { runGenerateOutline } = await import('../../ai/generateOutline');
    const outlineModel = { modelName: 'fake', generate: jest.fn() };
    await expect(
      runGenerateOutline({ db, demoGate: true, now: () => NOW, model: outlineModel }, 'phone-1', {
        bookId: 'b',
        synopsis: 'Una sinossi.',
        requestId: 'r1',
      }),
    ).rejects.toMatchObject({ details: { reason: 'demo-closed' } });
    expect(outlineModel.generate).not.toHaveBeenCalled();
  });
});

describe('the judge claim', () => {
  const deps = (db: Firestore, setJudgeClaim = jest.fn(async (uid: string) => void uid)) => ({
    db,
    gateEnabled: true,
    setJudgeClaim,
    now: () => NOW,
  });

  it('the right code puts the claim on the account', async () => {
    const { db } = makeDb(config());
    const setJudgeClaim = jest.fn(async (uid: string) => void uid);
    await runRedeemAccessCode(deps(db, setJudgeClaim), 'phone-1', CODE);
    expect(setJudgeClaim).toHaveBeenCalledWith('phone-1');
  });

  it('a wrong code never sets it', async () => {
    const { db } = makeDb(config());
    const setJudgeClaim = jest.fn(async (uid: string) => void uid);
    await expect(runRedeemAccessCode(deps(db, setJudgeClaim), 'phone-1', 'x')).rejects.toThrow();
    expect(setJudgeClaim).not.toHaveBeenCalled();
  });

  it('without the claim on the token, even a marked phone is refused', async () => {
    const { db } = makeDb(config());
    await runRedeemAccessCode(deps(db), 'phone-1', CODE);
    await expect(requireDemoAccess(db, 'phone-1', undefined, NOW)).rejects.toMatchObject({
      details: { reason: 'access-code-required' },
    });
    await expect(requireDemoAccess(db, 'phone-1', { judge: 'true' }, NOW)).rejects.toThrow();
  });

  it('a claim without the server marker (forged elsewhere) is refused', async () => {
    const { db } = makeDb(config());
    await expect(requireDemoAccess(db, 'phone-9', JUDGE, NOW)).rejects.toMatchObject({
      details: { reason: 'access-code-required' },
    });
  });

  it('new accounts from the same address run out of attempts too', async () => {
    const { db } = makeDb(config());
    for (let i = 0; i < 30; i++) {
      await expect(
        runRedeemAccessCode(deps(db), `phone-${i}`, 'guess', '203.0.113.7'),
      ).rejects.toMatchObject({ details: { reason: 'wrong-code' } });
    }
    // more WRONG codes from that address are refused…
    await expect(
      runRedeemAccessCode(deps(db), 'phone-new', 'guess', '203.0.113.7'),
    ).rejects.toMatchObject({ details: { reason: 'too-many-attempts' } });
    // …but the RIGHT code always passes, even from the same address
    await expect(
      runRedeemAccessCode(deps(db), 'phone-judge', CODE, '203.0.113.7'),
    ).resolves.toEqual({ ok: true });
  });

  it('no overall cap can lock real judges out: wrong codes raise an alarm instead', async () => {
    const { db, store } = makeDb(config());
    for (let i = 0; i < 60; i++) {
      await runRedeemAccessCode(deps(db), `bot-${i}`, 'guess', `198.51.100.${i}`).catch(() => {});
    }
    const day = new Date(NOW).toISOString().slice(0, 10);
    expect(store.get(`usageDaily/${day}__redeemAccessCodeWrong`)).toMatchObject({ count: 60 });
    await expect(runRedeemAccessCode(deps(db), 'judge', CODE, '198.51.100.200')).resolves.toEqual({
      ok: true,
    });
  });

  it('IPv6: compressed and expanded forms of one /64 share a key', async () => {
    const { ipCounterKey, ipv6Network64 } = await import('../redeemAccessCode');
    expect(ipv6Network64('2001:db8::1')).toBe('2001:db8:0:0');
    expect(ipCounterKey('2001:db8::1')).toBe(ipCounterKey('2001:0db8:0000:0000:ffff::9'));
    expect(ipCounterKey('2001:db8:0:1::1')).not.toBe(ipCounterKey('2001:db8::1'));
    expect(ipv6Network64('203.0.113.7')).toBeUndefined();
  });

  it('exports and backup need the claim too', async () => {
    const { withDemoAccess } = await import('../demoGate');
    const { db } = makeDb(config());
    const inner = jest.fn(async () => 'file');
    const gated = withDemoAccess(db, true, inner);
    const request = (token?: Record<string, unknown>) =>
      ({ auth: { uid: 'phone-1', token }, data: {} }) as never;
    await expect(gated(request())).rejects.toMatchObject({ code: 'permission-denied' });
    expect(inner).not.toHaveBeenCalled();
    // outside the demo the handler is untouched
    expect(withDemoAccess(db, false, inner)).toBe(inner);
  });
});

describe('the address used for the per-network cap', () => {
  it('is the rightmost X-Forwarded-For entry, the one the client cannot write', async () => {
    const { callerAddress, ipCounterKey } = await import('../redeemAccessCode');
    expect(
      callerAddress({ headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, ip: '1.2.3.4' }),
    ).toBe('203.0.113.7');
    expect(callerAddress({ headers: {}, ip: '198.51.100.1' })).toBe('198.51.100.1');
    // a client rotating its own header still lands on the same key
    expect(
      ipCounterKey(callerAddress({ headers: { 'x-forwarded-for': 'spoof-a, 203.0.113.7' } })),
    ).toBe(ipCounterKey(callerAddress({ headers: { 'x-forwarded-for': 'spoof-b, 203.0.113.7' } })));
    // IPv6: one key per /64
    expect(ipCounterKey('2001:db8:1:2:aaaa::1')).toBe(ipCounterKey('2001:db8:1:2:bbbb::9'));
  });
});

describe('refineTitle in the demo', () => {
  it('without the code: refused before the model; with it: the title caps apply', async () => {
    const { createRefineTitleHandler } = await import('../../ai/refineTitle');
    const { db, store } = makeDb(config());
    const model = {
      modelName: 'fake',
      generate: jest.fn(async () => ({ proposals: ['Nuovo titolo'] })),
    };
    const handler = createRefineTitleHandler({ db, model, demoGate: true, now: () => NOW });
    const data = { bookId: 'b1', chapterId: 'c1', title: 'Titolo', requestId: 'r1' };
    await expect(
      handler({ auth: { uid: 'phone-1', token: {} }, data } as never),
    ).rejects.toMatchObject({ details: { reason: 'access-code-required' } });
    expect(model.generate).not.toHaveBeenCalled();
    // hostile ids never reach a path
    await expect(
      handler({
        auth: { uid: 'phone-1', token: JUDGE },
        data: { ...data, bookId: '../x' },
      } as never),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    // switched off: closed at once
    store.set('config/demo', config({ enabled: false }));
    await expect(
      handler({ auth: { uid: 'phone-1', token: JUDGE }, data } as never),
    ).rejects.toMatchObject({ details: { reason: 'demo-closed' } });
  });

  it('the title has its own caps in config/demo', () => {
    expect(demoUsageLimits(config()).refineTitle).toEqual(PROPOSED_DEMO_LIMITS.refineTitle);
  });
});

describe('follow-ups of #38', () => {
  const deps = (db: Firestore) => ({
    db,
    gateEnabled: true,
    setJudgeClaim: jest.fn(async (uid: string) => void uid),
    now: () => NOW,
  });

  it('right codes never use up the phone allowance; wrong ones do', async () => {
    const { db } = makeDb(config());
    for (let i = 0; i < 15; i++) {
      await expect(runRedeemAccessCode(deps(db), 'phone-1', CODE)).resolves.toEqual({ ok: true });
    }
    for (let i = 0; i < 10; i++) {
      await expect(runRedeemAccessCode(deps(db), 'phone-2', 'wrong code')).rejects.toMatchObject({
        details: { reason: 'wrong-code' },
      });
    }
    // used up: refused before comparing, even with the right code
    await expect(runRedeemAccessCode(deps(db), 'phone-2', CODE)).rejects.toMatchObject({
      details: { reason: 'too-many-attempts' },
    });
  });

  it('IPv4-mapped IPv6 addresses count as their IPv4 address', async () => {
    const { ipCounterKey, ipv4FromMapped, ipv6Network64 } = await import('../redeemAccessCode');
    expect(ipv4FromMapped('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipv4FromMapped('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(ipv4FromMapped('2001:db8::1')).toBeUndefined();
    expect(ipv6Network64('::ffff:203.0.113.7')).toBeUndefined();
    expect(ipCounterKey('::ffff:203.0.113.7')).toBe(ipCounterKey('203.0.113.7'));
    expect(ipCounterKey('::FFFF:CB00:7107')).toBe(ipCounterKey('203.0.113.7'));
    // two IPv4 clients never share a key through the mapping
    expect(ipCounterKey('::ffff:203.0.113.8')).not.toBe(ipCounterKey('203.0.113.7'));
  });
});

describe('parallel attempts (review of #42)', () => {
  it('a phone one wrong code from its cap cannot try 20 codes at once', async () => {
    const { db, store } = makeDb(config());
    const day = new Date(NOW).toISOString().slice(0, 10);
    store.set(`usageDaily/${day}__redeemAccessCode/users/phone-1`, { count: 9 });
    const deps = {
      db,
      gateEnabled: true,
      setJudgeClaim: jest.fn(async (uid: string) => void uid),
      now: () => NOW,
    };
    const codes = [...Array.from({ length: 19 }, (_, i) => `wrong code ${i}`), CODE];
    const outcomes = await Promise.all(
      codes.map((code) =>
        runRedeemAccessCode(deps, 'phone-1', code).then(
          () => 'ok',
          (e: { details?: { reason?: string } }) => e.details?.reason,
        ),
      ),
    );
    expect(outcomes.filter((o) => o === 'wrong-code')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'too-many-attempts')).toHaveLength(19);
    expect(outcomes).not.toContain('ok');
    expect(deps.setJudgeClaim).not.toHaveBeenCalled();
  });

  it('a right code gives its reserved slot back', async () => {
    const { db, store } = makeDb(config());
    const day = new Date(NOW).toISOString().slice(0, 10);
    const deps = {
      db,
      gateEnabled: true,
      setJudgeClaim: jest.fn(async (uid: string) => void uid),
      now: () => NOW,
    };
    await runRedeemAccessCode(deps, 'phone-1', CODE);
    expect(store.get(`usageDaily/${day}__redeemAccessCode/users/phone-1`)).toMatchObject({
      count: 0,
    });
  });
});
