import { FirebaseError } from 'firebase/app';

import { setLanguage } from '../../i18n';
import { callableErrorMessage, logCallableFailure } from '../callableErrors';

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
