import { render, waitFor } from '@testing-library/react-native';

import { setLanguage } from '../../../i18n';
import { ThemeProvider } from '../../../theme';
import { InMemoryExportFileSink } from '../../export';
import { InMemoryBackupService } from '../backup';
import { LocalSettingsRepository } from '../LocalSettingsRepository';
import { SettingsScreen } from '../SettingsScreen';

describe('SettingsScreen in English', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => setLanguage('it'));

  it('shows English labels', async () => {
    const storage = { getItem: async () => null, setItem: async () => {} };
    const { getByText } = await render(
      <ThemeProvider>
        <SettingsScreen
          repository={new LocalSettingsRepository(storage)}
          backupService={new InMemoryBackupService()}
          backupFileSink={new InMemoryExportFileSink()}
        />
      </ThemeProvider>,
    );
    await waitFor(() => expect(getByText(/No backup yet/)).toBeTruthy());
    expect(getByText('Black and gold')).toBeTruthy();
  });
});
