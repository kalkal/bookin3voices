// Shared microphone control (dictation screen and note capture): the state is
// told by icon, colour AND words, and announced to screen readers.

import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { candlelightPalette, paperPalette, ThemeProvider } from '../../../theme';
import { micAppearance } from '../MicButton';
import { MicControl } from '../MicControl';

function renderControl(state: 'idle' | 'listening' | 'paused' | 'reconnecting', status: string) {
  return render(
    <ThemeProvider>
      <MicControl state={state} status={status} onPress={() => {}} testID="mic" />
    </ThemeProvider>,
  );
}

afterEach(() => jest.restoreAllMocks());

describe('MicControl', () => {
  it('listening: mic icon, pulsing ring and «Sto ascoltando…»', async () => {
    const screen = await renderControl('listening', 'Sto ascoltando…');
    expect(screen.getByTestId('mic-icon-mic')).toBeOnTheScreen();
    expect(screen.getByTestId('mic-ring')).toBeOnTheScreen();
    expect(screen.getByTestId('mic-status')).toHaveTextContent('Sto ascoltando…');
  });

  it('paused: slashed mic, no ring and «In pausa — tocca per riprendere»', async () => {
    const screen = await renderControl('paused', 'In pausa — tocca per riprendere');
    expect(screen.getByTestId('mic-icon-mic-off')).toBeOnTheScreen();
    expect(screen.queryByTestId('mic-ring')).toBeNull();
    expect(screen.getByTestId('mic-status')).toHaveTextContent('In pausa — tocca per riprendere');
  });

  it('reconnecting: sync icon, no pulse, «Riconnessione…»', async () => {
    const screen = await renderControl('reconnecting', 'Riconnessione…');
    expect(screen.getByTestId('mic-icon-sync')).toBeOnTheScreen();
    expect(screen.queryByTestId('mic-ring')).toBeNull();
    expect(screen.getByTestId('mic-status')).toHaveTextContent('Riconnessione…');
  });

  it('every change is announced exactly once (no live region reading it again)', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const screen = await renderControl('listening', 'Sto ascoltando…');
    expect(screen.getByTestId('mic-status')).not.toHaveProp('accessibilityLiveRegion');
    await act(async () =>
      screen.rerender(
        <ThemeProvider>
          <MicControl
            state="paused"
            status="In pausa — tocca per riprendere"
            onPress={() => {}}
            testID="mic"
          />
        </ThemeProvider>,
      ),
    );
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenLastCalledWith('In pausa — tocca per riprendere');
  });
});

describe('micAppearance (both themes)', () => {
  it.each([
    ['paper', paperPalette],
    ['candlelight', candlelightPalette],
  ] as const)('%s: listening is the gold mic, paused the grey slashed mic', (_name, palette) => {
    const listening = micAppearance('listening', palette);
    const paused = micAppearance('paused', palette);
    expect(listening).toMatchObject({
      icon: 'mic',
      background: palette.micListening,
      iconColor: palette.onMicListening,
    });
    expect(paused).toMatchObject({
      icon: 'mic-off',
      iconColor: palette.micPaused,
      border: palette.micPaused,
    });
    expect(listening.background).not.toBe(paused.background);
    expect(micAppearance('reconnecting', palette)).toMatchObject({
      icon: 'sync',
      iconColor: palette.micListening,
      border: palette.micListening,
      background: palette.surface,
    });
  });
});
