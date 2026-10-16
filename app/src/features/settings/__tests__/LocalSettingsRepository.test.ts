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
  it('senza nulla di salvato tornano i default, con aiProvider = bedrock', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalSettingsRepository(storage);
    const settings = await repo.load();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.aiProvider).toBe('bedrock');
    expect(settings.theme).toBe('paper');
  });

  it('salva e rilegge il documento completo (round-trip)', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalSettingsRepository(storage);
    const modificate: AppSettings = {
      schemaVersion: 1,
      aiProvider: 'gemini',
      theme: 'candlelight',
      dailyGoalWords: 1200,
      backupFrequency: 'daily',
      lastBackupAt: 1788688800000,
    };
    await repo.save(modificate);
    await expect(repo.load()).resolves.toEqual(modificate);
  });

  it('payload salvato prima della feature Backup (senza lastBackupAt): si legge, niente default', async () => {
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
      aiProvider: 'gemini',
      theme: 'candlelight',
      dailyGoalWords: 900,
      backupFrequency: 'monthly',
      lastBackupAt: null,
    });
  });

  it('il payload salvato è versionato (schemaVersion per upgrade-on-read)', async () => {
    const { storage, data } = memoryStorage();
    const repo = new LocalSettingsRepository(storage);
    await repo.save(DEFAULT_SETTINGS);
    expect(JSON.parse(data.get(KEY) ?? '')).toMatchObject({ schemaVersion: 1 });
  });

  it('payload corrotto: niente crash, si riparte dai default', async () => {
    const { storage } = memoryStorage({ [KEY]: '{non-json' });
    const repo = new LocalSettingsRepository(storage);
    await expect(repo.load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('payload di uno schema sconosciuto o fuori range: default, mai valori invalidi', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 99, aiProvider: 'skynet', dailyGoalWords: -5 }),
    });
    const repo = new LocalSettingsRepository(storage);
    await expect(repo.load()).resolves.toEqual(DEFAULT_SETTINGS);
  });
});
