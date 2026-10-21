// Dev test log: dictation state changes, engine errors and the recognizer.

import { act, fireEvent, render } from '@testing-library/react-native';

import { captureTestLog } from '../../../testing/testLog';
import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import type { KeyValueStorage } from '../../chapters';
import { uninstallTestLog } from '../../testLog';
import { DictationScreen } from '../DictationScreen';
import { FakeDictationEngine } from '../engines/FakeDictationEngine';
import type { PreflightChecks } from '../preflight';

jest.mock('expo-network', () => ({ useNetworkState: () => ({ isConnected: true }) }));

const CHAPTER = { bookId: 'libro-test', chapterId: 'cap-test' };
const CHECKS: PreflightChecks = {
  isRecognitionAvailable: () => true,
  getPermissions: async () => ({ granted: true, canAskAgain: true }),
  requestPermissions: async () => ({ granted: true, canAskAgain: true }),
  getSupportedLocales: async () => ({ locales: ['it-IT'], installedLocales: ['it-IT'] }),
  platform: 'android',
};
const storage: KeyValueStorage = { getItem: async () => null, setItem: async () => {} };

afterEach(() => uninstallTestLog());

it('records start, pause and engine errors of a dictation session', async () => {
  const log = captureTestLog();
  const engine = new FakeDictationEngine();
  const utils = await render(
    <ThemeProvider>
      <DictationScreen
        chapter={CHAPTER}
        chapterTitle="Capitolo I"
        repository={new InMemoryChapterRepository()}
        engine={engine}
        preflightChecks={CHECKS}
        outlineStateStorage={storage}
      />
    </ThemeProvider>,
  );
  await act(async () => {});

  await fireEvent.press(utils.getByTestId('dictation-mic'));
  await act(async () => engine.emitStart());
  await act(async () =>
    engine.emitError({ code: 'network', message: 'net', recoverable: true, nativeCode: 'net-2' }),
  );
  await fireEvent.press(utils.getByTestId('dictation-mic'));

  const states = log.events('dictation.state');
  expect(states[0]).toMatchObject({
    chapterId: 'cap-test',
    to: 'listening',
    lang: 'it-IT',
    recognizer: 'unknown',
  });
  expect(states.map((s) => s.to)).toContain('paused');
  expect(log.events('dictation.event')).toContainEqual(
    expect.objectContaining({ event: 'engine-error', code: 'network', nativeCode: 'net-2' }),
  );
  await utils.unmount();
});
