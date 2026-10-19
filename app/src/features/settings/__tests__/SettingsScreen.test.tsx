import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { KeyValueStorage } from '../../chapters';
import { ThemeProvider, useTheme } from '../../../theme';
import { InMemoryExportFileSink } from '../../export';
import { InMemoryBackupService } from '../backup';
import type { BackupService } from '../backup';
import { LocalSettingsRepository } from '../LocalSettingsRepository';
import { SettingsScreen } from '../SettingsScreen';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
  return { storage, data };
}

const KEY = 'bookvoice/settings/app';

/** Exposes the ThemeProvider's current mode and cathedral switch next to the screen. */
function ModeProbe() {
  const { mode, ornaments } = useTheme();
  return (
    <>
      <Text testID="mode-probe">{mode}</Text>
      <Text testID="ornaments-probe">{ornaments ? 'on' : 'off'}</Text>
    </>
  );
}

async function renderScreen(
  storage: KeyValueStorage,
  backupService: BackupService = new InMemoryBackupService(),
) {
  const repository = new LocalSettingsRepository(storage);
  const fileSink = new InMemoryExportFileSink();
  const screen = await render(
    <ThemeProvider>
      <ModeProbe />
      <SettingsScreen
        repository={repository}
        backupService={backupService}
        backupFileSink={fileSink}
      />
    </ThemeProvider>,
  );
  return Object.assign(screen, { fileSink });
}

describe('SettingsScreen', () => {
  it('by default the active engine is Amazon Nova, with Gemini as the alternative', async () => {
    const { storage } = memoryStorage();
    const screen = await renderScreen(storage);
    const provider = await screen.findByTestId('provider-bedrock');
    expect(provider).toHaveTextContent(/Amazon Nova/);
    expect(provider).toHaveTextContent(/Attivo/);
    expect(screen.getByTestId('provider-gemini')).not.toHaveTextContent(/Attivo/);
    expect(screen.getByText('Lite')).toBeOnTheScreen();
    expect(screen.getByText('Flash')).toBeOnTheScreen();
    expect(screen.getByTestId('goal-value')).toHaveTextContent('500');
    await screen.unmount();
  });

  it('changing the theme applies to the ThemeProvider and persists across restart', async () => {
    const { storage, data } = memoryStorage();
    const prima = await renderScreen(storage);
    expect(await prima.findByTestId('mode-probe')).toHaveTextContent('candlelight');

    await fireEvent.press(await prima.findByTestId('theme-paper'));
    expect(prima.getByTestId('mode-probe')).toHaveTextContent('paper');
    await waitFor(() =>
      expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({
        theme: 'paper',
        themeChosen: true,
      }),
    );
    await prima.unmount();

    // "restart": new screen on the same persistence
    const dopo = await renderScreen(storage);
    await waitFor(() => expect(dopo.getByTestId('mode-probe')).toHaveTextContent('paper'));
    expect(dopo.getByTestId('theme-paper')).toHaveTextContent('Carta');
    expect(dopo.getByTestId('theme-candlelight')).toHaveTextContent('Nero e oro');
    await dopo.unmount();
  });

  it('changing the daily goal persists across restart', async () => {
    const { storage, data } = memoryStorage();
    const prima = await renderScreen(storage);
    await fireEvent.press(await prima.findByTestId('goal-increase'));
    expect(prima.getByTestId('goal-value')).toHaveTextContent('600');
    await waitFor(() =>
      expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({ dailyGoalWords: 600 }),
    );
    await prima.unmount();

    const dopo = await renderScreen(storage);
    await waitFor(() => expect(dopo.getByTestId('goal-value')).toHaveTextContent('600'));
    await dopo.unmount();
  });

  it('the goal does not go below the minimum', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({
        schemaVersion: 1,
        aiProvider: 'gemini',
        theme: 'paper',
        dailyGoalWords: 100,
        backupFrequency: 'weekly',
      }),
    });
    const screen = await renderScreen(storage);
    await fireEvent.press(await screen.findByTestId('goal-decrease'));
    expect(screen.getByTestId('goal-value')).toHaveTextContent('100');
    await screen.unmount();
  });

  it('the backup frequency can be changed and persists', async () => {
    const { storage, data } = memoryStorage();
    const screen = await renderScreen(storage);
    await fireEvent.press(await screen.findByTestId('backup-daily'));
    await waitFor(() =>
      expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({ backupFrequency: 'daily' }),
    );
    await screen.unmount();
  });

  it('"Scarica backup ora": shares the zip and records the last backup', async () => {
    const { storage, data } = memoryStorage();
    const screen = await renderScreen(storage);

    // before the first backup: visual nudge
    const status = await screen.findByTestId('backup-status');
    expect(status).toHaveTextContent(/Nessun backup ancora/);
    expect(status).toHaveTextContent(/consigliato un nuovo backup/);

    await fireEvent.press(screen.getByTestId('backup-now'));
    await waitFor(() => expect(screen.getByTestId('backup-progress')).toHaveTextContent(/salvato/));
    expect(screen.getByTestId('backup-progress')).toHaveTextContent(
      /«backup-bookvoice-2026-09-06\.zip» salvato \(1 libro, 1 KB\)\./,
    );
    expect(screen.fileSink.shared).toHaveLength(1);
    expect(screen.fileSink.shared[0]?.mimeType).toBe('application/zip');

    // the reminder restarts from today and the date persists
    expect(screen.getByTestId('backup-status')).toHaveTextContent(/Ultimo backup: oggi/);
    await waitFor(() =>
      expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({
        lastBackupAt: expect.any(Number),
      }),
    );
    await screen.unmount();
  });

  it('failed backup: visible error message, no "last backup" recorded', async () => {
    const { storage, data } = memoryStorage();
    const rotto: BackupService = {
      exportBackup: async () => {
        throw new Error('Il backup supera il limite di risposta (~10 MB).');
      },
    };
    const screen = await renderScreen(storage, rotto);
    await fireEvent.press(await screen.findByTestId('backup-now'));
    await waitFor(() =>
      expect(screen.getByTestId('backup-progress')).toHaveTextContent(/supera il limite/),
    );
    expect(screen.fileSink.shared).toHaveLength(0);
    expect(JSON.parse(data.get(KEY) ?? '{}').lastBackupAt ?? null).toBeNull();
    await screen.unmount();
  });

  it('backup older than the chosen frequency: visual nudge', async () => {
    const dieciGiorniFa = Date.now() - 10 * 86_400_000;
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({
        schemaVersion: 1,
        aiProvider: 'gemini',
        theme: 'paper',
        dailyGoalWords: 500,
        backupFrequency: 'weekly',
        lastBackupAt: dieciGiorniFa,
      }),
    });
    const screen = await renderScreen(storage);
    const status = await screen.findByTestId('backup-status');
    expect(status).toHaveTextContent(/Ultimo backup: 10 giorni fa/);
    expect(status).toHaveTextContent(/consigliato un nuovo backup/);
    await screen.unmount();
  });

  it('style profiles list suspense, mystery and thriller (suspense is the default)', async () => {
    const { storage } = memoryStorage();
    const screen = await renderScreen(storage);
    expect(await screen.findByTestId('style-profile-suspense')).toHaveTextContent(/Predefinito/);
    expect(await screen.findByTestId('style-profile-mystery')).toHaveTextContent(/Mystery/);
    expect(await screen.findByTestId('style-profile-thriller')).toHaveTextContent(/Thriller/);
    await screen.unmount();
  });

  it('the cathedral drawing can be switched off in Settings, and it stays off after a restart', async () => {
    const { storage, data } = memoryStorage();
    const prima = await renderScreen(storage);
    expect(await prima.findByTestId('ornaments-probe')).toHaveTextContent('on');
    // Settings itself has little room for it: no arches behind this screen
    expect(prima.queryByTestId('cathedral-arches')).toBeNull();

    await fireEvent.press(await prima.findByTestId('ornaments-toggle'));
    expect(prima.getByTestId('ornaments-probe')).toHaveTextContent('off');
    await waitFor(() =>
      expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({ ornaments: false }),
    );
    await prima.unmount();

    const dopo = await renderScreen(storage);
    await waitFor(() => expect(dopo.getByTestId('ornaments-probe')).toHaveTextContent('off'));
    await dopo.unmount();
  });
});
