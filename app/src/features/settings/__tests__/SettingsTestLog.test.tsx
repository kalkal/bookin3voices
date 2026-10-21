// «Scarica registro» (dev builds only): saves the test log through the file sink.

import { fireEvent, render, screen } from '@testing-library/react-native';

import type { KeyValueStorage } from '../../chapters';
import { ThemeProvider } from '../../../theme';
import { base64ToUint8Array, InMemoryExportFileSink } from '../../export';
import { InMemoryBackupService } from '../backup';
import { LocalSettingsRepository } from '../LocalSettingsRepository';
import { SettingsScreen } from '../SettingsScreen';
import type { TestLogStore } from '../../testLog';

const storage: KeyValueStorage = { getItem: async () => null, setItem: async () => {} };

async function renderWith(testLog?: TestLogStore) {
  const fileSink = new InMemoryExportFileSink();
  await render(
    <ThemeProvider>
      <SettingsScreen
        repository={new LocalSettingsRepository(storage)}
        backupService={new InMemoryBackupService()}
        backupFileSink={fileSink}
        testLog={testLog}
      />
    </ThemeProvider>,
  );
  return fileSink;
}

describe('Settings › test log', () => {
  it('is absent without a test log (store and public builds)', async () => {
    await renderWith();
    expect(screen.queryByTestId('test-log-download')).toBeNull();
  });

  it('saves the current log as a .jsonl file through the sink', async () => {
    const content = '{"t":"2026-10-21T10:00:00.000Z","seq":0,"type":"header"}\n';
    const fileSink = await renderWith({
      location: 'file:///storage/emulated/0/Android/data/dev.kalkal.bookvoice/files/registro-prove',
      append: () => {},
      read: () => content,
    });
    expect(screen.getByText('Scarica registro')).toBeTruthy();
    expect(screen.getByText(/Android\/data\/dev\.kalkal\.bookvoice/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('test-log-download'));

    expect(await screen.findByTestId('test-log-progress')).toHaveTextContent(/salvato/i);
    expect(fileSink.shared).toHaveLength(1);
    const [file] = fileSink.shared;
    expect(file?.fileName).toMatch(/^registro-prove-\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(new TextDecoder().decode(base64ToUint8Array(file?.base64 ?? ''))).toBe(content);
  });

  it('a failed save shows the error and logs its name', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fileSink = await renderWith({ location: 'x', append: () => {}, read: () => '' });
    fileSink.saveAndShare = async () => {
      throw new TypeError('share sheet gone');
    };

    fireEvent.press(screen.getByTestId('test-log-download'));

    expect(await screen.findByTestId('test-log-progress')).toHaveTextContent(
      /Non è stato possibile salvare il registro/,
    );
    expect(warn).toHaveBeenCalledWith('test-log-download-failed', { error: 'TypeError' });
    warn.mockRestore();
  });
});
