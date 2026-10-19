// The UI follows the app language: in English the session counter is translated.

import { fireEvent, render } from '@testing-library/react-native';

import { setLanguage } from '../../../i18n';
import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import { DictationScreen } from '../DictationScreen';
import { FakeDictationEngine } from '../engines/FakeDictationEngine';

describe('DictationScreen in English', () => {
  afterEach(() => setLanguage('it'));

  it('shows the English session counter', async () => {
    setLanguage('en');
    const { getByTestId } = await render(
      <ThemeProvider>
        <DictationScreen
          chapter={{ bookId: 'b', chapterId: 'c' }}
          repository={new InMemoryChapterRepository()}
          engine={new FakeDictationEngine()}
          preflightChecks={{
            isRecognitionAvailable: () => true,
            getPermissions: async () => ({ granted: true, canAskAgain: true }),
            requestPermissions: async () => ({ granted: true, canAskAgain: true }),
            getSupportedLocales: async () => ({ locales: [], installedLocales: [] }),
            platform: 'ios',
          }}
        />
      </ThemeProvider>,
    );
    expect(getByTestId('dictation-words')).toHaveTextContent('0 words this session');
  });
});

describe('DictationScreen — dictation language follows the book, not the interface', () => {
  afterEach(() => setLanguage('it'));

  const checks = {
    isRecognitionAvailable: () => true,
    getPermissions: async () => ({ granted: true, canAskAgain: true }),
    requestPermissions: async () => ({ granted: true, canAskAgain: true }),
    getSupportedLocales: async () => ({ locales: [], installedLocales: [] }),
    platform: 'ios' as const,
  };

  it('an English dictation in the Italian interface shows English commands and listens in English', async () => {
    const engine = new FakeDictationEngine();
    const { getByTestId, getByText, queryByText } = await render(
      <ThemeProvider>
        <DictationScreen
          chapter={{ bookId: 'b', chapterId: 'c' }}
          repository={new InMemoryChapterRepository()}
          engine={engine}
          preflightChecks={checks}
          lang="en-US"
        />
      </ThemeProvider>,
    );
    expect(getByText('«period»')).toBeOnTheScreen();
    expect(getByText('«new paragraph»')).toBeOnTheScreen();
    expect(queryByText('«punto»')).toBeNull();
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(engine.startCalls).toEqual([{ lang: 'en-US' }]);
  });

  it('without a language the hints follow the interface language (Italian)', async () => {
    const { getByText } = await render(
      <ThemeProvider>
        <DictationScreen
          chapter={{ bookId: 'b', chapterId: 'c' }}
          repository={new InMemoryChapterRepository()}
          engine={new FakeDictationEngine()}
          preflightChecks={checks}
        />
      </ThemeProvider>,
    );
    expect(getByText('«punto»')).toBeOnTheScreen();
  });
});
