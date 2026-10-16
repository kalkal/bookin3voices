import type { KeyValueStorage } from '../../chapters';
import { LocalRevisionRepository } from '../revisions';
import type { RevisionRecord } from '../ReviewSession';

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

const REF = { bookId: 'libro', chapterId: 'cap-1' };
const KEY = 'bookvoice/revisions/libro/cap-1';

function revision(id: string, decision: 'accepted' | 'rejected' = 'accepted'): RevisionRecord {
  return { id, span: { from: 0, to: 4 }, before: 'Posò', after: 'Mise', decision, at: 123 };
}

describe('LocalRevisionRepository (storico, dataset per il tuning)', () => {
  it('append + list conservano ordine e round-trip su disco', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalRevisionRepository(storage);
    await repo.append(REF, revision('r1'));
    await repo.append(REF, revision('r2', 'rejected'));
    const listed = await repo.list(REF);
    expect(listed.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(listed[1].decision).toBe('rejected');
  });

  it('remove toglie solo la revisione annullata dall’undo', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalRevisionRepository(storage);
    await repo.append(REF, revision('r1'));
    await repo.append(REF, revision('r2'));
    await repo.remove(REF, 'r1');
    expect((await repo.list(REF)).map((r) => r.id)).toEqual(['r2']);
  });

  it('capitolo mai toccato → lista vuota', async () => {
    const repo = new LocalRevisionRepository(memoryStorage().storage);
    expect(await repo.list(REF)).toEqual([]);
  });

  it('payload corrotto → quarantena col timestamp, non si butta lo storico', async () => {
    const { storage, data } = memoryStorage({ [KEY]: '{rotto' });
    const repo = new LocalRevisionRepository(storage);
    expect(await repo.list(REF)).toEqual([]);
    const quarantined = [...data.keys()].find((k) => k.startsWith(`${KEY}:quarantena-`));
    expect(quarantined).toBeDefined();
    expect(data.get(quarantined!)).toBe('{rotto');
  });

  it('capitoli diversi non si mischiano', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalRevisionRepository(storage);
    await repo.append(REF, revision('r1'));
    expect(await repo.list({ bookId: 'libro', chapterId: 'cap-2' })).toEqual([]);
  });
});
