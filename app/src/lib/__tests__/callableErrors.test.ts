import { FirebaseError } from 'firebase/app';

import { setLanguage } from '../../i18n';
import {
  callableErrorMessage,
  isAccessCodeRequired,
  isAiUnavailable,
  logCallableFailure,
} from '../callableErrors';

beforeAll(() => setLanguage('it'));
afterEach(() => jest.restoreAllMocks());

describe('callableErrorMessage', () => {
  it('AI unreachable (internal/unavailable/deadline): plain message that says to retry', () => {
    for (const code of ['internal', 'unavailable', 'deadline-exceeded', 'unknown']) {
      const error = new FirebaseError(`functions/${code}`, 'INTERNAL');
      expect(callableErrorMessage('refine', error)).toBe(
        'I suggerimenti non sono arrivati. Riprova tra poco.',
      );
      expect(callableErrorMessage('outline', error)).toBe(
        'La scaletta non è arrivata. Riprova tra poco.',
      );
      expect(callableErrorMessage('export', error)).toBe(
        'L’esportazione non è riuscita. Riprova tra poco.',
      );
    }
  });

  it('never shows the raw technical message', () => {
    const error = new FirebaseError(
      'functions/internal',
      'The security token included in the request is expired',
    );
    expect(callableErrorMessage('refine', error)).not.toMatch(/token|expired/);
  });

  it('a plain error (network, invalid response) gets the same plain message', () => {
    expect(callableErrorMessage('refine', new Error('ZodError: expected array'))).toBe(
      'I suggerimenti non sono arrivati. Riprova tra poco.',
    );
    expect(callableErrorMessage('outline', 'boom')).toBe(
      'La scaletta non è arrivata. Riprova tra poco.',
    );
  });

  it('expired sign-in: says to reopen the app', () => {
    const error = new FirebaseError('functions/unauthenticated', 'Sign-in required.');
    expect(callableErrorMessage('refine', error)).toBe(
      'La sessione è scaduta: chiudi e riapri l’app, poi riprova.',
    );
  });

  it('daily limit reached: says when to retry', () => {
    const error = new FirebaseError('functions/resource-exhausted', 'Daily limit reached');
    expect(callableErrorMessage('outline', error)).toBe(
      'Hai raggiunto il limite di oggi per questa funzione. Riprova domani.',
    );
  });

  it('export of a book that is not ready: says what to fix', () => {
    const error = new FirebaseError(
      'functions/failed-precondition',
      'Il libro non ha capitoli da esportare.',
    );
    expect(callableErrorMessage('export', error)).toBe(
      'Il libro non è ancora pronto per l’esportazione: controlla i capitoli e i dati del libro, poi riprova.',
    );
  });
});

describe('logCallableFailure', () => {
  it('logs action, requestId and code as one structured line, never the text', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new FirebaseError('functions/internal', 'testo-del-capitolo');
    logCallableFailure('refine', 'ref-123', error);
    expect(warn).toHaveBeenCalledTimes(1);
    const [label, payload] = warn.mock.calls[0] ?? [];
    expect(label).toBe('callable-failed');
    expect(payload).toEqual({ action: 'refine', requestId: 'ref-123', code: 'internal' });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/testo-del-capitolo/);
  });

  it('a plain error is logged with its name as the code', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logCallableFailure('outline', 'out-1', new TypeError('Network request failed'));
    expect(warn.mock.calls[0]?.[1]).toEqual({
      action: 'outline',
      requestId: 'out-1',
      code: 'TypeError',
    });
  });
});

describe('judges build (details.reason from the server)', () => {
  function demoError(code: string, details: unknown): FirebaseError {
    return Object.assign(new FirebaseError(`functions/${code}`, 'server message'), { details });
  }
  const SAMPLE = 'Intanto il libro di esempio mostra suggerimenti di esempio già registrati.';

  afterEach(() => setLanguage('it'));

  it('demo closed: says the live AI is off and points to the sample book', () => {
    const error = demoError('failed-precondition', { reason: 'demo-closed' });
    expect(callableErrorMessage('refine', error)).toBe(
      `L’IA dal vivo di questa demo è spenta. ${SAMPLE}`,
    );
    expect(callableErrorMessage('outline', error)).toBe(
      `L’IA dal vivo di questa demo è spenta. ${SAMPLE}`,
    );
  });

  it('limit reached: says which limit, when it resets, and points to the sample book', () => {
    const user = demoError('resource-exhausted', {
      reason: 'limit-reached',
      scope: 'user',
      resetsAt: 1_800_000_000_000,
    });
    expect(callableErrorMessage('refine', user)).toBe(
      `Questo telefono ha usato tutta l’IA disponibile oggi per la demo. Si azzera a mezzanotte UTC. ${SAMPLE}`,
    );
    const global = demoError('resource-exhausted', { reason: 'limit-reached', scope: 'global' });
    expect(callableErrorMessage('outline', global)).toBe(
      `L’IA disponibile oggi per tutta la demo è esaurita. Si azzera a mezzanotte UTC. ${SAMPLE}`,
    );
    const total = demoError('resource-exhausted', { reason: 'limit-reached', scope: 'total' });
    expect(callableErrorMessage('refine', total)).toBe(
      `L’IA disponibile per l’intera demo è esaurita. ${SAMPLE}`,
    );
    expect(callableErrorMessage('refine', total)).not.toMatch(/mezzanotte/);
  });

  it('text too long: says the maximum and what to shorten', () => {
    const error = demoError('invalid-argument', { reason: 'text-too-long', maxChars: 12000 });
    expect(callableErrorMessage('refine', error)).toBe(
      'Questo testo è troppo lungo per l’IA della demo (al massimo 12.000 caratteri): seleziona una parte più corta e rifinisci quella.',
    );
    expect(callableErrorMessage('outline', error)).toBe(
      'La sinossi è troppo lunga per l’IA della demo (al massimo 12.000 caratteri): accorciala e riprova.',
    );
  });

  it('access code required (prompt cancelled): says where the code is and to tap Retry', () => {
    const error = demoError('permission-denied', { reason: 'access-code-required' });
    expect(callableErrorMessage('refine', error)).toMatch(/codice d’accesso.*Devpost.*Riprova/);
  });

  it('English messages', () => {
    setLanguage('en');
    const error = demoError('resource-exhausted', { reason: 'limit-reached', scope: 'user' });
    expect(callableErrorMessage('refine', error)).toBe(
      'This phone has used today’s AI allowance for the demo. It resets at midnight UTC. Meanwhile, the sample book shows pre-recorded example suggestions.',
    );
    const long = demoError('invalid-argument', { reason: 'text-too-long', maxChars: 12000 });
    expect(callableErrorMessage('outline', long)).toMatch(/at most 12,000 characters/);
  });

  it('without details the usual messages stay (non-judges builds)', () => {
    expect(callableErrorMessage('refine', demoError('resource-exhausted', undefined))).toBe(
      'Hai raggiunto il limite di oggi per questa funzione. Riprova domani.',
    );
    expect(
      callableErrorMessage('export', demoError('failed-precondition', { reason: 'demo-closed' })),
    ).toBe(
      'Il libro non è ancora pronto per l’esportazione: controlla i capitoli e i dati del libro, poi riprova.',
    );
  });

  it('logs the reason next to the code, never the text', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logCallableFailure(
      'refine',
      'ref-9',
      demoError('failed-precondition', { reason: 'demo-closed' }),
    );
    expect(warn.mock.calls[0]?.[1]).toEqual({
      action: 'refine',
      requestId: 'ref-9',
      code: 'failed-precondition',
      reason: 'demo-closed',
    });
  });
});

describe('isAiUnavailable / isAccessCodeRequired', () => {
  const make = (code: string, details?: unknown) =>
    Object.assign(new FirebaseError(`functions/${code}`, 'x'), { details });

  it('true only for demo-closed and limit-reached', () => {
    expect(isAiUnavailable(make('failed-precondition', { reason: 'demo-closed' }))).toBe(true);
    expect(
      isAiUnavailable(make('resource-exhausted', { reason: 'limit-reached', scope: 'total' })),
    ).toBe(true);
    expect(isAiUnavailable(make('resource-exhausted'))).toBe(false);
    expect(isAiUnavailable(make('permission-denied', { reason: 'access-code-required' }))).toBe(
      false,
    );
    expect(
      isAiUnavailable(make('invalid-argument', { reason: 'text-too-long', maxChars: 5 })),
    ).toBe(false);
    expect(isAiUnavailable(make('internal'))).toBe(false);
    expect(isAiUnavailable(new Error('demo-closed'))).toBe(false);
    expect(isAiUnavailable(undefined)).toBe(false);
  });

  it('access code required is recognised by code and reason together', () => {
    expect(
      isAccessCodeRequired(make('permission-denied', { reason: 'access-code-required' })),
    ).toBe(true);
    expect(isAccessCodeRequired(make('permission-denied', { reason: 'wrong-code' }))).toBe(false);
    expect(isAccessCodeRequired(make('permission-denied'))).toBe(false);
  });
});
