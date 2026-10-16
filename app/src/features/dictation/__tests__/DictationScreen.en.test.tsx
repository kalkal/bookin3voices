// The UI follows the app language: in English the session counter is translated.

import { render } from '@testing-library/react-native';

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
