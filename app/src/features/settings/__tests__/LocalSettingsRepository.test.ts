import type { KeyValueStorage } from '../../chapters';
import { LocalSettingsRepository } from '../LocalSettingsRepository';
import { DEFAULT_SETTINGS } from '../types';
import type { AppSettings } from '../types';

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

describe('LocalSettingsRepository', () => {
  it('with nothing saved the defaults are returned, with no AI provider choice', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalSettingsRepository(storage);
    const settings = await repo.load();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toHaveProperty('aiProvider');
    expect(settings.theme).toBe('candlelight');
  });

  it('saves and re-reads the full document (round-trip)', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalSettingsRepository(storage);
    const modificate: AppSettings = {
      schemaVersion: 1,
      theme: 'candlelight',
      dailyGoalWords: 1200,
      backupFrequency: 'daily',
      lastBackupAt: 1788688800000,
    };
    await repo.save(modificate);
    await expect(repo.load()).resolves.toEqual(modificate);
  });

  it('payload saved before the Backup feature (without lastBackupAt): it is read, no defaults', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({
        schemaVersion: 1,
        aiProvider: 'gemini',
        theme: 'candlelight',
        dailyGoalWords: 900,
        backupFrequency: 'monthly',
      }),
    });
    const repo = new LocalSettingsRepository(storage);
    await expect(repo.load()).resolves.toEqual({
      schemaVersion: 1,
      theme: 'candlelight',
      dailyGoalWords: 900,
      backupFrequency: 'monthly',
      lastBackupAt: null,
    });
  });

  it('an old local aiProvider (never sent to the server) is dropped and cleaned on disk', async () => {
    const { storage, data } = memoryStorage({
      [KEY]: JSON.stringify({
        schemaVersion: 1,
        aiProvider: 'gemini',
        theme: 'candlelight',
        dailyGoalWords: 900,
        backupFrequency: 'monthly',
      }),
    });
    const repo = new LocalSettingsRepository(storage);
    const settings = await repo.load();
    expect(settings).not.toHaveProperty('aiProvider');
    expect(settings.dailyGoalWords).toBe(900);
    expect(JSON.parse(data.get(KEY) ?? '{}')).not.toHaveProperty('aiProvider');
  });

  it('the saved payload is versioned (schemaVersion for upgrade-on-read)', async () => {
    const { storage, data } = memoryStorage();
    const repo = new LocalSettingsRepository(storage);
    await repo.save(DEFAULT_SETTINGS);
    expect(JSON.parse(data.get(KEY) ?? '')).toMatchObject({ schemaVersion: 1 });
  });

  it('corrupt payload: no crash, start again from the defaults', async () => {
    const { storage } = memoryStorage({ [KEY]: '{non-json' });
    const repo = new LocalSettingsRepository(storage);
    await expect(repo.load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('payload of an unknown schema or out of range: defaults, never invalid values', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 99, aiProvider: 'skynet', dailyGoalWords: -5 }),
    });
    const repo = new LocalSettingsRepository(storage);
    await expect(repo.load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  describe('theme saved before black and gold became the default', () => {
    const legacy = (theme: string, extra: object = {}) => ({
      [KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, theme, ...extra }),
    });

    it('a saved "paper" that was never chosen moves to black and gold', async () => {
      // old documents were saved whole by any change, with the old default
      const repo = new LocalSettingsRepository(memoryStorage(legacy('paper')).storage);
      expect((await repo.load()).theme).toBe('candlelight');
    });

    it('a "paper" chosen on purpose is kept', async () => {
      const repo = new LocalSettingsRepository(
        memoryStorage(legacy('paper', { themeChosen: true })).storage,
      );
      expect((await repo.load()).theme).toBe('paper');
    });

    it('other saved themes are left alone', async () => {
      for (const theme of ['auto', 'candlelight']) {
        const repo = new LocalSettingsRepository(memoryStorage(legacy(theme)).storage);
        expect((await repo.load()).theme).toBe(theme);
      }
    });
  });
});
