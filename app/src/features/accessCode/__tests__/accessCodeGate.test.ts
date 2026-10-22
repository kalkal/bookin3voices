import { FirebaseError } from 'firebase/app';

import {
  AccessCodeGate,
  CallableAccessCodeService,
  GatedOutlineService,
  isAccessGateEnabled,
  isWellFormedAccessCode,
  redeemFailure,
  type AccessCodeService,
  GatedTitleRefineService,
} from '../accessCodeGate';

function callableError(code: string, details?: unknown): FirebaseError {
  const error = new FirebaseError(`functions/${code}`, 'server message');
  return Object.assign(error, { details });
}

const codeRequired = () => callableError('permission-denied', { reason: 'access-code-required' });

function fakeService(outcomes: (Error | null)[]): AccessCodeService & { codes: string[] } {
  const codes: string[] = [];
  return {
    codes,
    redeem: async (code) => {
      codes.push(code);
      const next = outcomes.shift() ?? null;
      if (next !== null) throw next;
    },
  };
}

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('isAccessGateEnabled', () => {
  const original = process.env.EXPO_PUBLIC_ACCESS_GATE;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_ACCESS_GATE;
    else process.env.EXPO_PUBLIC_ACCESS_GATE = original;
  });

  it('is on only with EXPO_PUBLIC_ACCESS_GATE=1', () => {
    delete process.env.EXPO_PUBLIC_ACCESS_GATE;
    expect(isAccessGateEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_ACCESS_GATE = '0';
    expect(isAccessGateEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_ACCESS_GATE = '1';
    expect(isAccessGateEnabled()).toBe(true);
  });
});

describe('AccessCodeGate.run', () => {
  it('passes through results and errors that are not about the access code', async () => {
    const gate = new AccessCodeGate(fakeService([]));
    await expect(gate.run(async () => 42)).resolves.toBe(42);
    const limit = callableError('resource-exhausted', { reason: 'limit-reached', scope: 'user' });
    await expect(
      gate.run(async () => {
        throw limit;
      }),
    ).rejects.toBe(limit);
    expect(gate.getState().open).toBe(false);
  });

  it('access-code-required: opens the prompt, redeems, retries the call once', async () => {
    const service = fakeService([null]);
    const gate = new AccessCodeGate(service);
    const action = jest.fn().mockRejectedValueOnce(codeRequired()).mockResolvedValueOnce('ok');
    const result = gate.run(action);
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.getState()).toEqual({ open: true, submitting: false, failure: null });
    await gate.submit('  JUDGE-2026 ');
    await expect(result).resolves.toBe('ok');
    expect(service.codes).toEqual(['JUDGE-2026']);
    expect(action).toHaveBeenCalledTimes(2);
    expect(gate.getState().open).toBe(false);
  });

  it('wrong code keeps the prompt open with the reason; cancel rethrows the original error', async () => {
    const service = fakeService([callableError('permission-denied', { reason: 'wrong-code' })]);
    const gate = new AccessCodeGate(service);
    const original = codeRequired();
    const action = jest.fn().mockRejectedValue(original);
    const result = gate.run(action);
    await Promise.resolve();
    await Promise.resolve();
    await gate.submit('NOPE-CODE-1');
    expect(gate.getState()).toEqual({ open: true, submitting: false, failure: 'wrong-code' });
    gate.cancel();
    await expect(result).rejects.toBe(original);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('two refused calls share one prompt and both retry after one redeem', async () => {
    const service = fakeService([null]);
    const gate = new AccessCodeGate(service);
    const first = jest.fn().mockRejectedValueOnce(codeRequired()).mockResolvedValueOnce(1);
    const second = jest.fn().mockRejectedValueOnce(codeRequired()).mockResolvedValueOnce(2);
    const results = Promise.all([gate.run(first), gate.run(second)]);
    await Promise.resolve();
    await Promise.resolve();
    await gate.submit('GIURIA-2026');
    await expect(results).resolves.toEqual([1, 2]);
    expect(service.codes).toHaveLength(1);
  });

  it('an empty code is not sent', async () => {
    const service = fakeService([]);
    const gate = new AccessCodeGate(service);
    void gate.requestCode();
    await gate.submit('   ');
    expect(service.codes).toEqual([]);
  });

  it('never logs the code', async () => {
    const warn = jest.spyOn(console, 'warn');
    const info = jest.spyOn(console, 'info');
    const gate = new AccessCodeGate(
      fakeService([callableError('permission-denied', { reason: 'wrong-code' }), null]),
    );
    void gate.requestCode();
    await gate.submit('SECRET-1');
    await gate.submit('SECRET-2');
    expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toMatch(/SECRET/);
  });

  it('decorates the outline service', async () => {
    const gate = new AccessCodeGate(fakeService([null]));
    const proposal = { chapters: [], model: 'm', promptVersion: 1 };
    const inner = {
      generateOutline: jest
        .fn()
        .mockRejectedValueOnce(codeRequired())
        .mockResolvedValueOnce(proposal),
    };
    const request = { bookId: 'b', synopsis: 's', requestId: 'out-1' };
    const result = new GatedOutlineService(inner, gate).generateOutline(request);
    await Promise.resolve();
    await Promise.resolve();
    await gate.submit('GIURIA-2026');
    await expect(result).resolves.toBe(proposal);
    expect(inner.generateOutline).toHaveBeenNthCalledWith(2, request);
  });
});

describe('redeemFailure', () => {
  it('maps the redeemAccessCode errors to the prompt messages', () => {
    expect(redeemFailure(callableError('permission-denied', { reason: 'wrong-code' }))).toBe(
      'wrong-code',
    );
    expect(
      redeemFailure(callableError('resource-exhausted', { reason: 'too-many-attempts' })),
    ).toBe('too-many-attempts');
    expect(redeemFailure(callableError('failed-precondition', { reason: 'demo-closed' }))).toBe(
      'demo-closed',
    );
    expect(redeemFailure(callableError('unavailable'))).toBe('unreachable');
    expect(redeemFailure(new TypeError('Network request failed'))).toBe('unreachable');
  });
});

describe('CallableAccessCodeService', () => {
  it('sends { code } and accepts { ok: true }', async () => {
    const call = jest.fn().mockResolvedValue({ data: { ok: true } });
    await new CallableAccessCodeService({ call }).redeem('abc');
    expect(call).toHaveBeenCalledWith({ code: 'abc' });
  });

  it('an unexpected response is a failure', async () => {
    const call = jest.fn().mockResolvedValue({ data: { ok: false } });
    await expect(new CallableAccessCodeService({ call }).redeem('abc')).rejects.toThrow();
  });
});

describe('access code format (checked before any server call)', () => {
  const HOSTILE = [
    "' OR 1=1 --",
    '../../etc/passwd',
    '{"code":"GIURIA-2026"}',
    'GIURIA-2026-😀',
    '<script>alert(1)</script>',
    '${process.env.SECRET}',
    'A'.repeat(33),
    'X'.repeat(10_000),
    'SHORT',
    'GIURIA_2026',
    'GIURIA\n2026',
  ];

  it.each(HOSTILE.map((code) => [code]))(
    'refuses %j locally, never calling the server',
    async (code) => {
      const service = fakeService([]);
      const gate = new AccessCodeGate(service);
      void gate.requestCode();
      await gate.submit(code);
      expect(service.codes).toEqual([]);
      expect(gate.getState()).toEqual({ open: true, submitting: false, failure: 'invalid-format' });
    },
  );

  it('accepts letters, digits, spaces and hyphens, 8 to 32 characters, trimmed', () => {
    expect(isWellFormedAccessCode('GIURIA-2026')).toBe(true);
    expect(isWellFormedAccessCode('  giuria 2026 ab  ')).toBe(true);
    expect(isWellFormedAccessCode('A'.repeat(8))).toBe(true);
    expect(isWellFormedAccessCode('A'.repeat(32))).toBe(true);
    expect(isWellFormedAccessCode('A'.repeat(7))).toBe(false);
    for (const code of HOSTILE) expect(isWellFormedAccessCode(code)).toBe(false);
  });

  it('never logs a refused code, not even partially', async () => {
    const warn = jest.spyOn(console, 'warn');
    const gate = new AccessCodeGate(fakeService([]));
    void gate.requestCode();
    await gate.submit('<script>TOPSECRET</script>');
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/TOPSECRET|script/);
  });
});

describe('GatedTitleRefineService (review of #38)', () => {
  it('asks for the code when the server requires it, then retries once', async () => {
    const results = [
      { ok: false as const, message: 'code needed', accessCodeRequired: true },
      { ok: true as const, proposals: ['Nuovo titolo'] },
    ];
    const inner = { suggestTitles: jest.fn(async () => results.shift()!) };
    const gate = { requestCode: jest.fn(async () => true) };
    const service = new GatedTitleRefineService(inner, gate as never);
    const request = { bookId: 'b', chapterId: 'c', title: 'T', requestId: 'r' };
    await expect(service.suggestTitles(request)).resolves.toEqual({
      ok: true,
      proposals: ['Nuovo titolo'],
    });
    expect(gate.requestCode).toHaveBeenCalledTimes(1);
    expect(inner.suggestTitles).toHaveBeenCalledTimes(2);
  });

  it('other failures pass through without the prompt', async () => {
    const inner = {
      suggestTitles: jest.fn(async () => ({ ok: false as const, message: 'offline' })),
    };
    const gate = { requestCode: jest.fn(async () => true) };
    const service = new GatedTitleRefineService(inner, gate as never);
    await expect(
      service.suggestTitles({ bookId: 'b', chapterId: 'c', title: 'T', requestId: 'r' }),
    ).resolves.toEqual({ ok: false, message: 'offline' });
    expect(gate.requestCode).not.toHaveBeenCalled();
  });
});
