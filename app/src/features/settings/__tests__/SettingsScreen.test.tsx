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

/** Espone il modo corrente del ThemeProvider accanto alla schermata. */
function ModeProbe() {
  const { mode } = useTheme();
  return <Text testID="mode-probe">{mode}</Text>;
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
  it('di default il motore attivo è Gemini, con i tier Flash e Pro in vista', async () => {
    const { storage } = memoryStorage();
    const screen = await renderScreen(storage);
    const provider = await screen.findByTestId('provider-gemini');
    expect(provider).toHaveTextContent(/Attivo/);
    expect(screen.getByText('Flash')).toBeOnTheScreen();
    expect(screen.getByText('Pro')).toBeOnTheScreen();
    expect(screen.getByTestId('goal-value')).toHaveTextContent('500');
    await screen.unmount();
  });

  it('il cambio tema si applica al ThemeProvider e persiste al riavvio', async () => {
    const { storage, data } = memoryStorage();
    const prima = await renderScreen(storage);
    expect(await prima.findByTestId('mode-probe')).toHaveTextContent('paper');

    await fireEvent.press(await prima.findByTestId('theme-candlelight'));
    expect(prima.getByTestId('mode-probe')).toHaveTextContent('candlelight');
    await waitFor(() =>
      expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({ theme: 'candlelight' }),
    );
    await prima.unmount();

    // "riavvio": nuova schermata sulla stessa persistenza
    const dopo = await renderScreen(storage);
    await waitFor(() => expect(dopo.getByTestId('mode-probe')).toHaveTextContent('candlelight'));
    expect(dopo.getByTestId('theme-candlelight')).toHaveTextContent('A lume di candela');
    await dopo.unmount();
  });

  it('il cambio di obiettivo giornaliero persiste al riavvio', async () => {
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

  it("l'obiettivo non scende sotto il minimo", async () => {
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

  it('la frequenza di backup si cambia e persiste', async () => {
    const { storage, data } = memoryStorage();
    const screen = await renderScreen(storage);
    await fireEvent.press(await screen.findByTestId('backup-daily'));
    await waitFor(() =>
      expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({ backupFrequency: 'daily' }),
    );
    await screen.unmount();
  });

  it('"Scarica backup ora": condivide lo zip e registra l\'ultimo backup', async () => {
    const { storage, data } = memoryStorage();
    const screen = await renderScreen(storage);

    // prima del primo backup: sollecito visivo
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

    // il promemoria riparte da oggi e la data persiste
    expect(screen.getByTestId('backup-status')).toHaveTextContent(/Ultimo backup: oggi/);
    await waitFor(() =>
      expect(JSON.parse(data.get(KEY) ?? '{}')).toMatchObject({
        lastBackupAt: expect.any(Number),
      }),
    );
    await screen.unmount();
  });

  it('backup fallito: messaggio di errore visibile, nessun "ultimo backup" registrato', async () => {
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

  it('backup più vecchio della frequenza scelta: sollecito visivo', async () => {
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

  it('i profili di stile elencano suspense, mystery e thriller (suspense predefinito)', async () => {
    const { storage } = memoryStorage();
    const screen = await renderScreen(storage);
    expect(await screen.findByTestId('style-profile-suspense')).toHaveTextContent(/Predefinito/);
    expect(await screen.findByTestId('style-profile-mystery')).toHaveTextContent(/Mystery/);
    expect(await screen.findByTestId('style-profile-thriller')).toHaveTextContent(/Thriller/);
    await screen.unmount();
  });
});
