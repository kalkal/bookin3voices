import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { getLanguage, setLanguage } from '../../../i18n';
import { ThemeProvider } from '../../../theme';
import { InMemoryExportFileSink } from '../../export';
import { InMemoryBackupService } from '../backup';
import { LocalSettingsRepository } from '../LocalSettingsRepository';
import { SettingsScreen } from '../SettingsScreen';

describe('SettingsScreen: interface language', () => {
  afterEach(() => setLanguage('it'));

  it('switches the interface to English right away and saves the choice', async () => {
    const saved: string[] = [];
    const storage = {
      getItem: async () => null,
      setItem: async (_key: string, value: string) => {
        saved.push(value);
      },
    };
    const screen = await render(
      <ThemeProvider>
        <SettingsScreen
          repository={new LocalSettingsRepository(storage)}
          backupService={new InMemoryBackupService()}
          backupFileSink={new InMemoryExportFileSink()}
        />
      </ThemeProvider>,
    );

    expect(await screen.findByText('Lingua')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('language-en'));

    expect(getLanguage()).toBe('en');
    expect(await screen.findByText('Language')).toBeOnTheScreen();
    await waitFor(() => expect(saved.at(-1)).toContain('"uiLanguage":"en"'));

    await fireEvent.press(screen.getByTestId('language-it'));
    expect(getLanguage()).toBe('it');
    expect(await screen.findByText('Lingua')).toBeOnTheScreen();
    await screen.unmount();
  });
});
