// The access code prompt as the judges see it: an AI call refused for a
// missing code opens it, a good code closes it and the call is retried, a
// wrong code shows the reason and keeps the prompt open.

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FirebaseError } from 'firebase/app';

import { ThemeProvider } from '../../../theme';
import type { RefineRequest, RefineResult, SuggestionsProvider } from '../../review';
import { AccessCodeModalHost } from '../AccessCodeModal';
import { AccessCodeGate, GatedSuggestionsProvider } from '../accessCodeGate';

function callableError(code: string, details: unknown): FirebaseError {
  return Object.assign(new FirebaseError(`functions/${code}`, 'server message'), { details });
}

const REQUEST: RefineRequest = {
  bookId: 'b',
  chapterId: 'c',
  text: 'Elena posò la tazza.',
  textHash: 'h',
  requestId: 'ref-1',
  rejected: [],
};
const RESULT = { suggestions: [] } as unknown as RefineResult;

async function setup(redeem: jest.Mock) {
  const inner: SuggestionsProvider = {
    refine: jest
      .fn()
      .mockRejectedValueOnce(callableError('permission-denied', { reason: 'access-code-required' }))
      .mockResolvedValue(RESULT),
  };
  const gate = new AccessCodeGate({ redeem });
  const provider = new GatedSuggestionsProvider(inner, gate);
  await render(
    <ThemeProvider>
      <AccessCodeModalHost gate={gate} />
    </ThemeProvider>,
  );
  return { inner, gate, provider };
}

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('AccessCodeModalHost', () => {
  it('is closed until an AI call asks for the code', async () => {
    await setup(jest.fn());
    expect(screen.queryByTestId('access-code-modal')).toBeNull();
  });

  it('access-code-required → prompt → good code → the AI call is retried once', async () => {
    const redeem = jest.fn().mockResolvedValue(undefined);
    const { inner, provider } = await setup(redeem);
    let result: Promise<RefineResult> | undefined;
    await act(async () => {
      result = provider.refine(REQUEST);
    });
    expect(await screen.findByText('Inserisci il codice d’accesso')).toBeTruthy();
    expect(screen.getByTestId('access-code-hint').props.children).toMatch(/Devpost/);
    await fireEvent.changeText(screen.getByTestId('access-code-input'), 'GIURIA-26');
    await fireEvent.press(screen.getByTestId('access-code-confirm'));
    await expect(result).resolves.toBe(RESULT);
    expect(redeem).toHaveBeenCalledWith('GIURIA-26');
    expect(inner.refine).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('access-code-modal')).toBeNull();
  });

  it('wrong code: clear message, prompt stays open; Cancel gives the error back', async () => {
    const redeem = jest
      .fn()
      .mockRejectedValue(callableError('permission-denied', { reason: 'wrong-code' }));
    const { inner, provider } = await setup(redeem);
    let result: Promise<RefineResult> | undefined;
    await act(async () => {
      result = provider.refine(REQUEST);
      // checked below: the rejection arrives while Cancel is pressed
      result.catch(() => {});
    });
    await fireEvent.changeText(await screen.findByTestId('access-code-input'), 'sbagliato');
    await fireEvent.press(screen.getByTestId('access-code-confirm'));
    expect(screen.getByTestId('access-code-error').props.children).toBe(
      'Il codice non è giusto. Controllalo e riprova.',
    );
    expect(screen.getByTestId('access-code-modal')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('access-code-cancel'));
    await expect(result).rejects.toMatchObject({ code: 'functions/permission-denied' });
    expect(inner.refine).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('access-code-modal')).toBeNull();
  });

  it('too many attempts and demo closed have their own messages', async () => {
    const redeem = jest
      .fn()
      .mockRejectedValueOnce(callableError('resource-exhausted', { reason: 'too-many-attempts' }))
      .mockRejectedValueOnce(callableError('failed-precondition', { reason: 'demo-closed' }));
    const { provider } = await setup(redeem);
    await act(async () => {
      provider.refine(REQUEST).catch(() => {});
    });
    await fireEvent.changeText(await screen.findByTestId('access-code-input'), 'XXXX-XXXX');
    await fireEvent.press(screen.getByTestId('access-code-confirm'));
    expect(screen.getByTestId('access-code-error').props.children).toMatch(/Troppi tentativi/);
    await fireEvent.press(screen.getByTestId('access-code-confirm'));
    expect(screen.getByTestId('access-code-error').props.children).toMatch(
      /demo con l’IA è chiusa.*libro di esempio/,
    );
  });
});

describe('AccessCodeModalHost input rules', () => {
  it('a hostile input is refused with a plain message, without calling the server or echoing it', async () => {
    const redeem = jest.fn();
    const { provider } = await setup(redeem);
    await act(async () => {
      provider.refine(REQUEST).catch(() => {});
    });
    const input = await screen.findByTestId('access-code-input');
    expect(input.props.maxLength).toBe(32);
    expect(input.props.autoCapitalize).toBe('characters');
    await fireEvent.changeText(input, "' OR 1=1 --");
    await fireEvent.press(screen.getByTestId('access-code-confirm'));
    expect(redeem).not.toHaveBeenCalled();
    const message = screen.getByTestId('access-code-error').props.children;
    expect(message).toBe('Il codice ha solo lettere, cifre e trattini (da 8 a 32 caratteri).');
    expect(message).not.toMatch(/OR 1=1/);
    expect(screen.getByTestId('access-code-modal')).toBeTruthy();
  });
});
