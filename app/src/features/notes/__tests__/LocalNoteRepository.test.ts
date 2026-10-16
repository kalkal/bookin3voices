// Outbox durabile delle note (review F2): upsert per id, rimozione, e payload
// corrotto messo in quarantena senza perdere lo storage (come LocalChapterRepository).

import { LocalNoteRepository, type KeyValueStorage } from '../LocalNoteRepository';
import type { Note } from '../types';

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

function note(id: string, over: Partial<Note> = {}): Note {
  return {
    id,
    bookId: 'libro-1',
    schemaVersion: 1,
    text: `nota ${id}`,
    tag: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('LocalNoteRepository', () => {
  it('outbox vuoto quando non c’è nulla', async () => {
    const { storage } = memoryStorage();
    expect(await new LocalNoteRepository(storage).listPending('libro-1')).toEqual([]);
  });

  it('savePending inserisce e poi aggiorna per id (nessun doppione)', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalNoteRepository(storage);
    await repo.savePending(note('a', { text: 'prima' }));
    await repo.savePending(note('b', { text: 'altra' }));
    await repo.savePending(note('a', { text: 'rivista' }));

    const pending = await repo.listPending('libro-1');
    expect(pending).toHaveLength(2);
    expect(pending.find((n) => n.id === 'a')?.text).toBe('rivista');
  });

  it('removePending toglie solo la nota indicata', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalNoteRepository(storage);
    await repo.savePending(note('a'));
    await repo.savePending(note('b'));
    await repo.removePending({ bookId: 'libro-1', noteId: 'a' });

    const pending = await repo.listPending('libro-1');
    expect(pending.map((n) => n.id)).toEqual(['b']);
  });

  it('sopravvive al "riavvio": un nuovo repository sullo stesso storage rilegge l’outbox', async () => {
    const { storage } = memoryStorage();
    await new LocalNoteRepository(storage).savePending(note('a', { text: 'persistente' }));
    const pending = await new LocalNoteRepository(storage).listPending('libro-1');
    expect(pending).toEqual([expect.objectContaining({ id: 'a', text: 'persistente' })]);
  });

  it('payload corrotto: quarantena e outbox vuoto (mai perdere lo storage)', async () => {
    const { storage, data } = memoryStorage();
    data.set('bookvoice/notes-outbox/libro-1', '{non è json valido');
    const repo = new LocalNoteRepository(storage);
    expect(await repo.listPending('libro-1')).toEqual([]);
    const quarantena = [...data.keys()].find((k) => k.includes(':quarantena-'));
    expect(quarantena).toBeDefined();
    expect(data.get(quarantena!)).toBe('{non è json valido');
  });
});
