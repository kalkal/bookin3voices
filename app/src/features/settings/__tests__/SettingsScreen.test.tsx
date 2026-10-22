import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { KeyValueStorage } from '../../chapters';
import { comesAfter, layoutRoom } from '../../../testing/arches';
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
  servedModel: string | null = null,
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
        servedModel={{ load: async () => servedModel }}
      />
    </ThemeProvider>,
  );
  return Object.assign(screen, { fileSink });
}

describe('SettingsScreen — author name', () => {
  it('"Nome dell\'autore" is saved with the settings and is there again after a restart', async () => {
    const { storage, data } = memoryStorage();
    const first = await renderScreen(storage);
    await fireEvent.changeText(await first.findByTestId('settings-author-name'), 'Jane Doe');
    await waitFor(() => expect(JSON.parse(data.get(KEY) ?? '{}').authorName).toBe('Jane Doe'));
    await first.unmount();

    const again = await renderScreen(storage);
    expect(await again.findByTestId('settings-author-name')).toHaveProp('value', 'Jane Doe');
    await again.unmount();
  });
});

describe('SettingsScreen', () => {
  it('the AI section is read-only: «AI: Amazon Nova Pro» and the model version', async () => {
    const { storage } = memoryStorage();
    const screen = await renderScreen(storage);
    expect(await screen.findByTestId('ai-engine')).toHaveTextContent('AI: Amazon Nova Pro');
    expect(screen.getByTestId('ai-model')).toHaveTextContent(/amazon\.nova-pro-v1:0/);
    expect(screen.queryByTestId('provider-bedrock')).toBeNull();
    expect(screen.queryByTestId('provider-gemini')).toBeNull();
    expect(screen.queryByText(/Gemini/)).toBeNull();
    expect(screen.getByTestId('goal-value')).toHaveTextContent('500');
    await screen.unmount();
  });

  it('the old local «Google Gemini» choice (September) is ignored and cleaned', async () => {
    const { storage, data } = memoryStorage({
      [KEY]: JSON.stringify({
        schemaVersion: 1,
        aiProvider: 'gemini',
        theme: 'candlelight',
        dailyGoalWords: 700,
        backupFrequency: 'weekly',
      }),
    });
    const screen = await renderScreen(storage);
    expect(await screen.findByTestId('ai-engine')).toHaveTextContent('AI: Amazon Nova Pro');
    expect(screen.queryByText(/Gemini/)).toBeNull();
    await waitFor(() => expect(JSON.parse(data.get(KEY) ?? '{}')).not.toHaveProperty('aiProvider'));
    expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({ dailyGoalWords: 700 });
    await screen.unmount();
  });

  it('shows the model the server actually answered with', async () => {
    const { storage } = memoryStorage();
    const screen = await renderScreen(storage, undefined, 'amazon.nova-lite-v1:0');
    await waitFor(() =>
      expect(screen.getByTestId('ai-engine')).toHaveTextContent('AI: Amazon Nova Lite'),
    );
    expect(screen.getByTestId('ai-model')).toHaveTextContent(/amazon\.nova-lite-v1:0/);
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

  it('style profiles list suspense, mystery and historical (suspense is the default)', async () => {
    const { storage } = memoryStorage();
    const screen = await renderScreen(storage);
    expect(await screen.findByTestId('style-profile-suspense')).toHaveTextContent(/Predefinito/);
    expect(await screen.findByTestId('style-profile-mystery')).toHaveTextContent(/Mystery/);
    expect(await screen.findByTestId('style-profile-historical')).toHaveTextContent(/Storico/);
    expect(screen.queryByTestId('style-profile-thriller')).toBeNull();
    await screen.unmount();
  });

  it('with room after the last section the arches stand there, after the content', async () => {
    const { storage } = memoryStorage();
    const screen = await renderScreen(storage);
    await screen.findByTestId('style-profile-historical');
    await layoutRoom(screen.getByTestId('arches-room'), 412, 240);
    expect(
      screen.getByTestId('cathedral-arches', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(
      comesAfter(screen.getByTestId('settings-screen'), 'style-profile-historical', 'arches-room'),
    ).toBe(true);
    await screen.unmount();
  });

  it('the cathedral drawing can be switched off in Settings, and it stays off after a restart', async () => {
    const { storage, data } = memoryStorage();
    const prima = await renderScreen(storage);
    expect(await prima.findByTestId('ornaments-probe')).toHaveTextContent('on');
    // never an overlay behind the settings: the arches only come after them, with room
    expect(prima.queryByTestId('cathedral-arches', { includeHiddenElements: true })).toBeNull();

    // a screen reader hears a switch, with its state
    expect((await prima.findByTestId('ornaments-toggle')).props).toMatchObject({
      accessibilityRole: 'switch',
      accessibilityState: { checked: true },
    });

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
