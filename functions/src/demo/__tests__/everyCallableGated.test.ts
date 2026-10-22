// Every callable exported by index.ts must go through the judges' demo gate:
// a callable added later without it would be open to anyone in the demo (the
// classic «the gate only covers the functions that existed»). The test loads
// the real module with DEMO_GATE=1, finds every exported callable by its
// trigger metadata and calls it as a signed-in phone WITHOUT the code: each one
// must refuse with access-code-required before doing anything. A new callable
// needs a valid request below (or a stated reason to stay open), or this fails.

import { textHash } from '../../ai/textHash';

type Data = Record<string, unknown>;

const store = new Map<string, Data>();
const NOW = Date.now();

class FakeDoc {
  constructor(readonly path: string) {}
  async get() {
    const data = store.get(this.path);
    return { exists: data !== undefined, data: () => data };
  }
  collection(name: string) {
    return { doc: (id: string) => new FakeDoc(`${this.path}/${name}/${id}`) };
  }
}

jest.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: jest.fn() }));
jest.mock('firebase-admin/auth', () => ({ getAuth: () => ({ setCustomUserClaims: jest.fn() }) }));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => new FakeDoc(path),
    runTransaction: () => {
      throw new Error('a gated call must not reach a transaction');
    },
  }),
}));

const UNGATED: Record<string, string> = {
  ping: 'returns { ok: true }, touches no data and no model',
  redeemAccessCode: 'is the gate itself',
};

/** A request each gated callable accepts, so the refusal comes from the gate. */
const VALID_REQUEST: Record<string, Data> = {
  refineChapter: {
    bookId: 'b1',
    chapterId: 'c1',
    text: 'T.',
    textHash: textHash('T.'),
    requestId: 'r1',
  },
  generateOutline: { bookId: 'b1', synopsis: 'Una sinossi.', requestId: 'r1' },
  refineTitle: { bookId: 'b1', chapterId: 'c1', title: 'Titolo', requestId: 'r1' },
  exportBook: { bookId: 'b1', format: 'epub', requestId: 'r1' },
  exportBackup: { requestId: 'r1' },
};

type Callable = {
  __endpoint?: { callableTrigger?: unknown };
  run: (req: unknown) => Promise<unknown>;
};

let callables: Array<[string, Callable]> = [];

beforeAll(async () => {
  process.env.DEMO_GATE = '1';
  store.set('config/demo', {
    enabled: true,
    codeSha256: 'a'.repeat(64),
    expiresAt: NOW + 86_400_000,
    maxTextChars: 30_000,
    limits: {
      refineChapter: { perUserPerDay: 15, globalPerDay: 40, total: 200 },
      generateOutline: { perUserPerDay: 2, globalPerDay: 5, total: 30 },
      refineTitle: { perUserPerDay: 10, globalPerDay: 30, total: 100 },
    },
  });
  const mod = (await import('../../index')) as Record<string, unknown>;
  callables = Object.entries(mod).filter(
    (entry): entry is [string, Callable] =>
      typeof entry[1] === 'function' &&
      (entry[1] as unknown as Callable).__endpoint?.callableTrigger !== undefined,
  );
});

afterAll(() => {
  delete process.env.DEMO_GATE;
});

describe('every exported callable is gated in the judges demo', () => {
  it('finds the callables of index.ts', () => {
    expect(callables.map(([name]) => name)).toEqual(
      expect.arrayContaining(['refineChapter', 'generateOutline', 'refineTitle', 'exportBook']),
    );
  });

  it('each one refuses a phone without the access code', async () => {
    for (const [name, callable] of callables) {
      if (name in UNGATED) continue;
      const data = VALID_REQUEST[name];
      if (data === undefined) {
        throw new Error(
          `${name}: new callable, add a valid request here (or a reason to stay open)`,
        );
      }
      const outcome = await callable
        .run({ auth: { uid: 'phone-1', token: {} }, data, rawRequest: { headers: {} } })
        .then(
          () => 'resolved',
          (error: { details?: { reason?: string }; message?: string }) =>
            error.details?.reason ?? `no reason: ${error.message ?? String(error)}`,
        );
      // the callable's name in the failure says which one is open
      expect([name, outcome]).toEqual([name, 'access-code-required']);
    }
  });
});
