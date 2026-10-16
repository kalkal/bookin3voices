// Regole del composito offline-first: mirror su disco prima di Firestore,
// lettura col più recente che vince, recovery del mirror verso il remoto,
// delta parole per l'obiettivo del giorno.

import { LocalChapterRepository, type KeyValueStorage } from '../LocalChapterRepository';
import { OfflineFirstChapterRepository } from '../OfflineFirstChapterRepository';
import type { Chapter, ChapterRef, ChapterRepository } from '../types';

const REF: ChapterRef = { bookId: 'libro-1', chapterId: 'cap-1' };

function memoryStorage() {
  const data = new Map<string, string>();
  const storage: KeyValueStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
  return { storage, data };
}

/** Remoto finto: solo ciò che il composito usa davvero. */
function fakeRemote() {
  const state: { chapter: Chapter | null; failGet: boolean } = { chapter: null, failGet: false };
  const saveRawText = jest.fn(async (ref: ChapterRef, rawText: string) => {
    state.chapter = {
      ...(state.chapter ?? {
        id: ref.chapterId,
        bookId: ref.bookId,
        schemaVersion: 1,
        outline: null,
        order: 0,
        title: '',
        status: 'draft',
        wordCount: 0,
        rawText: '',
        updatedAt: 0,
      }),
      rawText,
      updatedAt: Date.now(),
    };
  });
  const remote = {
    getChapter: jest.fn(async () => {
      if (state.failGet) throw new Error('offline');
      return state.chapter;
    }),
    loadRawText: jest.fn(async () => state.chapter?.rawText ?? null),
    saveRawText,
    observeChapters: jest.fn(() => () => {}),
    observeChapter: jest.fn(() => () => {}),
    createChapter: jest.fn(),
    updateChapter: jest.fn(),
    reorderChapters: jest.fn(),
    deleteChapter: jest.fn(),
  } as unknown as ChapterRepository & {
    getChapter: jest.Mock;
    saveRawText: jest.Mock;
  };
  return { remote, state };
}

function makeRepo(options?: { onWordsAdded?: (delta: number) => void }) {
  const { storage } = memoryStorage();
  const mirror = new LocalChapterRepository(storage);
  const { remote, state } = fakeRemote();
  const repo = new OfflineFirstChapterRepository({
    remote,
    mirror,
    onWordsAdded: options?.onWordsAdded,
  });
  return { repo, mirror, remote, state };
}

describe('OfflineFirstChapterRepository', () => {
  it('salva prima nel mirror e poi nel remoto', async () => {
    const { repo, mirror, remote } = makeRepo();
    await repo.saveRawText(REF, 'Il faro era spento.');
    expect(await mirror.loadRawText(REF)).toBe('Il faro era spento.');
    expect(remote.saveRawText).toHaveBeenCalledWith(REF, 'Il faro era spento.');
  });

  it('un remoto che fallisce non fa fallire il salvataggio (testo nel mirror)', async () => {
    const { repo, mirror, remote } = makeRepo();
    remote.saveRawText.mockRejectedValueOnce(new Error('permessi'));
    await expect(repo.saveRawText(REF, 'Testo prezioso')).resolves.toBeUndefined();
    expect(await mirror.loadRawText(REF)).toBe('Testo prezioso');
  });

  it('legge dal remoto quando il mirror non ha nulla', async () => {
    const { repo, state } = makeRepo();
    state.chapter = {
      id: REF.chapterId,
      bookId: REF.bookId,
      schemaVersion: 1,
      outline: null,
      order: 0,
      title: '',
      status: 'draft',
      wordCount: 3,
      rawText: 'Testo dal cloud',
      updatedAt: 100,
    };
    expect(await repo.loadRawText(REF)).toBe('Testo dal cloud');
  });

  it('ripiega sul mirror quando il remoto è irraggiungibile', async () => {
    const { repo, mirror, state } = makeRepo();
    await mirror.saveRawText(REF, 'Copia locale');
    state.failGet = true;
    expect(await repo.loadRawText(REF)).toBe('Copia locale');
  });

  it('lancia (mai "vuoto" al posto di "rotto") se remoto giù e mirror assente', async () => {
    const { repo, state } = makeRepo();
    state.failGet = true;
    await expect(repo.loadRawText(REF)).rejects.toThrow(/irraggiungibile/);
  });

  it('un mirror più recente vince e viene rispinto verso il remoto (recovery)', async () => {
    const { repo, mirror, remote, state } = makeRepo();
    state.chapter = {
      id: REF.chapterId,
      bookId: REF.bookId,
      schemaVersion: 1,
      outline: null,
      order: 0,
      title: '',
      status: 'draft',
      wordCount: 2,
      rawText: 'Versione vecchia',
      updatedAt: 1000,
    };
    await mirror.saveRawText(REF, 'Versione nuova dettata offline'); // updatedAt = adesso
    expect(await repo.loadRawText(REF)).toBe('Versione nuova dettata offline');
    expect(remote.saveRawText).toHaveBeenCalledWith(REF, 'Versione nuova dettata offline');
  });

  it('un remoto più recente vince senza recovery', async () => {
    const { repo, mirror, remote, state } = makeRepo();
    await mirror.saveRawText(REF, 'Versione vecchia locale');
    state.chapter = {
      id: REF.chapterId,
      bookId: REF.bookId,
      schemaVersion: 1,
      outline: null,
      order: 0,
      title: '',
      status: 'draft',
      wordCount: 2,
      rawText: 'Versione nuova dal cloud',
      updatedAt: Date.now() + 60_000,
    };
    expect(await repo.loadRawText(REF)).toBe('Versione nuova dal cloud');
    expect(remote.saveRawText).not.toHaveBeenCalled();
  });

  it('conta per l’obiettivo del giorno solo le parole aggiunte', async () => {
    const deltas: number[] = [];
    const { repo, state } = makeRepo({ onWordsAdded: (delta) => deltas.push(delta) });
    state.chapter = {
      id: REF.chapterId,
      bookId: REF.bookId,
      schemaVersion: 1,
      outline: null,
      order: 0,
      title: '',
      status: 'draft',
      wordCount: 3,
      rawText: 'tre parole qui',
      updatedAt: 100,
    };
    await repo.loadRawText(REF); // base: 3 parole
    await repo.saveRawText(REF, 'tre parole qui e altre due'); // 6 parole
    await repo.saveRawText(REF, 'tre parole'); // cancellazione: nessun delta
    await repo.saveRawText(REF, 'tre parole più una'); // 4 parole: +2 rispetto a 2
    expect(deltas).toEqual([3, 2]);
  });

  it('senza una lettura di base il primo salvataggio non genera delta', async () => {
    const deltas: number[] = [];
    const { repo } = makeRepo({ onWordsAdded: (delta) => deltas.push(delta) });
    await repo.saveRawText(REF, 'testo mai letto prima');
    expect(deltas).toEqual([]);
  });
});
