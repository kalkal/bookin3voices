import { LocalChapterRepository, type KeyValueStorage } from '../LocalChapterRepository';

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

const ref = { bookId: 'libro-1', chapterId: 'cap-1' };
const KEY = 'bookvoice/chapters/libro-1/cap-1';

describe('LocalChapterRepository', () => {
  it('un capitolo mai salvato è null (non stringa vuota)', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalChapterRepository(storage);
    await expect(repo.loadRawText(ref)).resolves.toBeNull();
  });

  it('salva e rilegge il testo grezzo (round-trip)', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalChapterRepository(storage);
    await repo.saveRawText(ref, 'Il caffè era ancora caldo.');
    await expect(repo.loadRawText(ref)).resolves.toBe('Il caffè era ancora caldo.');
  });

  it('capitoli e libri diversi non si pestano', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalChapterRepository(storage);
    await repo.saveRawText(ref, 'testo del primo');
    await repo.saveRawText({ bookId: 'libro-1', chapterId: 'cap-2' }, 'testo del secondo');
    await expect(repo.loadRawText(ref)).resolves.toBe('testo del primo');
    await expect(repo.loadRawText({ bookId: 'libro-2', chapterId: 'cap-1' })).resolves.toBeNull();
  });

  it('il payload salvato è versionato (schemaVersion per upgrade-on-read)', async () => {
    const { storage, data } = memoryStorage();
    const repo = new LocalChapterRepository(storage);
    await repo.saveRawText(ref, 'testo');
    const stored = JSON.parse(data.get(KEY) ?? '');
    expect(stored).toMatchObject({ schemaVersion: 1, rawText: 'testo' });
    expect(typeof stored.updatedAt).toBe('number');
  });

  it('payload corrotto: niente crash, si riparte da vuoto MA il blob va in quarantena', async () => {
    const { storage, data } = memoryStorage({ [KEY]: '{non-json' });
    const repo = new LocalChapterRepository(storage);
    await expect(repo.loadRawText(ref)).resolves.toBeNull();
    const quarantined = [...data.keys()].find((k) => k.startsWith(`${KEY}:quarantena-`));
    expect(quarantined).toBeDefined();
    expect(data.get(quarantined ?? '')).toBe('{non-json');
  });

  it('schema sconosciuto (versione futura): stessa quarantena, mai perdita silenziosa', async () => {
    const future = JSON.stringify({ schemaVersion: 2, rawText: 'testo nuovo', updatedAt: 1 });
    const { storage, data } = memoryStorage({ [KEY]: future });
    const repo = new LocalChapterRepository(storage);
    await expect(repo.loadRawText(ref)).resolves.toBeNull();
    expect([...data.keys()].some((k) => k.includes('quarantena'))).toBe(true);
  });
});
