import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';

import { setLanguage } from '../../../i18n';
import { StartupScreen } from '../StartupScreen';

const SLOW_MS = 3000;

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('StartupScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    setLanguage('it');
  });

  it('fast start: the mark in the middle, no hint, no spinner', async () => {
    const { getByTestId, queryByText, queryByTestId } = await render(
      <StartupScreen error={false} onRetry={jest.fn()} />,
    );
    expect(getByTestId('startup-mark')).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(SLOW_MS - 100);
    });
    expect(queryByText('Sto aprendo i tuoi libri…')).toBeNull();
    expect(queryByTestId('startup-retry')).toBeNull();
  });

  it('slow start (more than 3 s): a discreet line appears under the mark', async () => {
    const { getByText } = await render(<StartupScreen error={false} onRetry={jest.fn()} />);
    await act(async () => {
      jest.advanceTimersByTime(SLOW_MS + 100);
    });
    expect(getByText('Sto aprendo i tuoi libri…')).toBeOnTheScreen();
  });

  it('the slow-start line follows the app language', async () => {
    setLanguage('en');
    const { getByText } = await render(<StartupScreen error={false} onRetry={jest.fn()} />);
    await act(async () => {
      jest.advanceTimersByTime(SLOW_MS + 100);
    });
    expect(getByText('Opening your books…')).toBeOnTheScreen();
  });

  it('error: a clear message and a Retry button, never a dead screen', async () => {
    const onRetry = jest.fn();
    const { getByTestId, getByText, queryByText } = await render(
      <StartupScreen error onRetry={onRetry} />,
    );
    expect(getByTestId('auth-error')).toBeOnTheScreen();
    expect(getByText(/Non riesco ad aprire i tuoi libri/)).toBeOnTheScreen();
    expect(queryByText('Sto aprendo i tuoi libri…')).toBeNull();
    await fireEvent.press(getByTestId('startup-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(getByText('Riprova')).toBeOnTheScreen();
  });

  it('a screen reader is told about the slow-start line and about the error', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    const slow = await render(<StartupScreen error={false} onRetry={jest.fn()} />);
    // the live region exists from the start (empty), so the text added later is announced
    expect(slow.getByTestId('startup-status').props.accessibilityLiveRegion).toBe('polite');
    await act(async () => {
      jest.advanceTimersByTime(SLOW_MS + 100);
    });
    expect(slow.getByTestId('startup-status')).toHaveTextContent('Sto aprendo i tuoi libri…');
    expect(announce).toHaveBeenCalledWith('Sto aprendo i tuoi libri…');
    await slow.unmount();
    announce.mockClear();
    const failed = await render(<StartupScreen error onRetry={jest.fn()} />);
    expect(failed.getByTestId('startup-status').props.accessibilityLiveRegion).toBe('polite');
    expect(failed.getByTestId('startup-status')).toHaveTextContent(/Non riesco ad aprire/);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Non riesco ad aprire'));
  });

  it('the rays move slowly', async () => {
    const loop = jest.spyOn(Animated, 'loop');
    await render(<StartupScreen error={false} onRetry={jest.fn()} />);
    await flush();
    expect(loop).toHaveBeenCalled();
  });

  it('with "reduce motion" on the system the rays stay still', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const loop = jest.spyOn(Animated, 'loop');
    const { getByTestId } = await render(<StartupScreen error={false} onRetry={jest.fn()} />);
    await flush();
    expect(getByTestId('startup-rays')).toBeOnTheScreen();
    expect(loop).not.toHaveBeenCalled();
  });
});
