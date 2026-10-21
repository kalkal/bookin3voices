// Rules of the offline-first composite: mirror on disk before Firestore,
// most recent wins on read, mirror recovery toward the remote,
// word deltas for the daily goal.

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

/** Fake remote: only what the composite really uses. */
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
  it('saves to the mirror first and then to the remote', async () => {
    const { repo, mirror, remote } = makeRepo();
    await repo.saveRawText(REF, 'Il mulino era fermo.');
    expect(await mirror.loadRawText(REF)).toBe('Il mulino era fermo.');
    expect(remote.saveRawText).toHaveBeenCalledWith(REF, 'Il mulino era fermo.');
  });

  it('a failing remote does not fail the save, and says the text is only local', async () => {
    const { repo, mirror, remote } = makeRepo();
    remote.saveRawText.mockRejectedValueOnce(new Error('permissions'));
    await expect(repo.saveRawText(REF, 'Testo prezioso')).resolves.toBe('local-only');
    expect(await mirror.loadRawText(REF)).toBe('Testo prezioso');
  });

  it('mirror and remote both written: the save reports synced', async () => {
    const { repo } = makeRepo();
    await expect(repo.saveRawText(REF, 'Testo')).resolves.toBe('synced');
  });

  it('reads from the remote when the mirror has nothing', async () => {
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

  it('falls back to the mirror when the remote is unreachable', async () => {
    const { repo, mirror, state } = makeRepo();
    await mirror.saveRawText(REF, 'Copia locale');
    state.failGet = true;
    expect(await repo.loadRawText(REF)).toBe('Copia locale');
  });

  it('throws (never "empty" in place of "broken") if the remote is down and the mirror absent', async () => {
    const { repo, state } = makeRepo();
    state.failGet = true;
    await expect(repo.loadRawText(REF)).rejects.toThrow(/unreachable/);
  });

  it('a more recent mirror wins and is pushed back to the remote (recovery)', async () => {
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
    await mirror.saveRawText(REF, 'Versione nuova dettata offline'); // updatedAt = now
    expect(await repo.loadRawText(REF)).toBe('Versione nuova dettata offline');
    expect(remote.saveRawText).toHaveBeenCalledWith(REF, 'Versione nuova dettata offline');
  });

  it('a more recent remote wins without recovery', async () => {
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

  it('counts only the added words toward the daily goal', async () => {
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
    await repo.loadRawText(REF); // base: 3 words
    await repo.saveRawText(REF, 'tre parole qui e altre due'); // 6 words
    await repo.saveRawText(REF, 'tre parole'); // deletion: no delta
    await repo.saveRawText(REF, 'tre parole più una'); // 4 words: +2 compared to 2
    expect(deltas).toEqual([3, 2]);
  });

  it('without a baseline read the first save generates no delta', async () => {
    const deltas: number[] = [];
    const { repo } = makeRepo({ onWordsAdded: (delta) => deltas.push(delta) });
    await repo.saveRawText(REF, 'testo mai letto prima');
    expect(deltas).toEqual([]);
  });
});
