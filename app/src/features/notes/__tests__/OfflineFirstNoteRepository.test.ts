// Rules of the offline-first note composite: the durable outbox
// before Firestore, the note that shows up even when the remote rejects, the
// recovery when the remote returns and the outbox surviving an app restart
// (new repository on the SAME storage).

import { LocalNoteRepository, type KeyValueStorage } from '../LocalNoteRepository';
import { OfflineFirstNoteRepository } from '../OfflineFirstNoteRepository';
import type { SyncableNoteRepository } from '../FirestoreNoteRepository';
import type { CreateNoteInput, Note, NoteRef } from '../types';

const BOOK = 'libro-1';

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

/**
 * Fake remote = an in-memory mini-Firestore with an `online` switch.
 * Offline: putNote rejects (like an undelivered write) and observe does not
 * emit the note. Online: putNote stores and emits. newNoteId mints unique ids.
 */
function fakeRemote() {
  const store = new Map<string, Note>();
  const observers = new Set<(notes: Note[]) => void>();
  let online = false;
  let seq = 0;

  const keyFor = (ref: NoteRef) => `${ref.bookId}/${ref.noteId}`;
  const emit = () => {
    const notes = [...store.values()].sort((a, b) => b.createdAt - a.createdAt);
    for (const o of observers) o(notes);
  };

  const remote: SyncableNoteRepository = {
    newNoteId: () => `remote-${(seq += 1)}`,
    putNote: jest.fn(async (note: Note) => {
      if (!online) throw new Error('offline');
      store.set(keyFor({ bookId: note.bookId, noteId: note.id }), note);
      emit();
    }),
    observeNotes: (_bookId, onChange) => {
      observers.add(onChange);
      onChange([...store.values()].sort((a, b) => b.createdAt - a.createdAt));
      return () => observers.delete(onChange);
    },
    getNote: async (ref) => {
      if (!online) throw new Error('offline');
      return store.get(keyFor(ref)) ?? null;
    },
    createNote: jest.fn(async (bookId: string, input: CreateNoteInput) => {
      const note: Note = {
        id: `remote-${(seq += 1)}`,
        bookId,
        schemaVersion: 1,
        text: input.text,
        tag: input.tag ?? null,
        createdAt: 1,
        updatedAt: 1,
      };
      return note;
    }),
    updateNote: jest.fn(async () => {}),
    deleteNote: jest.fn(async (ref: NoteRef) => {
      store.delete(keyFor(ref));
      emit();
    }),
  };

  return {
    remote,
    store,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

/** Waits for the queued microtasks (background putNote) to drain. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let clock = 1000;
const tickingClock = () => (clock += 1);

beforeEach(() => {
  clock = 1000;
});

describe('OfflineFirstNoteRepository', () => {
  it('creates offline: the note is in the durable outbox and shows up, though the remote rejects', async () => {
    const { storage } = memoryStorage();
    const mirror = new LocalNoteRepository(storage);
    const { remote } = fakeRemote(); // stays offline

    const repo = new OfflineFirstNoteRepository({ remote, mirror, now: tickingClock });
    const emissions: Note[][] = [];
    repo.observeNotes(BOOK, (notes) => emissions.push(notes));
    await flush();

    const created = await repo.createNote(BOOK, { text: 'idea offline', tag: 'trama' });
    await flush();

    // durable outbox: the note is on "disk"
    expect(await mirror.listPending(BOOK)).toEqual([expect.objectContaining({ id: created.id })]);
    // and shows up in the view, even though the remote rejected the write
    const last = emissions[emissions.length - 1];
    expect(last.map((n) => n.text)).toContain('idea offline');
    expect(remote.putNote).toHaveBeenCalled();
  });

  it('when the remote returns, recovery re-syncs and empties the outbox', async () => {
    const { storage } = memoryStorage();
    const mirror = new LocalNoteRepository(storage);
    const fake = fakeRemote(); // offline

    const repo = new OfflineFirstNoteRepository({ remote: fake.remote, mirror, now: tickingClock });
    const unsub = repo.observeNotes(BOOK, () => {});
    await flush();
    const created = await repo.createNote(BOOK, { text: 'da sincronizzare' });
    await flush();
    expect(await mirror.listPending(BOOK)).toHaveLength(1);
    unsub();

    // the remote returns: reopening the Notebook (new observe) starts recovery
    fake.setOnline(true);
    const emissions: Note[][] = [];
    repo.observeNotes(BOOK, (notes) => emissions.push(notes));
    await flush();
    await flush();

    // the note is now on the remote and the outbox is empty (same id, no duplicates)
    expect(fake.store.has(`${BOOK}/${created.id}`)).toBe(true);
    expect(await mirror.listPending(BOOK)).toHaveLength(0);
    const last = emissions[emissions.length - 1];
    expect(last.filter((n) => n.text === 'da sincronizzare')).toHaveLength(1);
  });

  it('app restarted: the on-disk outbox survives and the note syncs when back online', async () => {
    const { storage } = memoryStorage(); // storage shared between the two "launches"

    // launch 1: offline, a note is created; the repository dies with the app
    const fake1 = fakeRemote();
    const repo1 = new OfflineFirstNoteRepository({
      remote: fake1.remote,
      mirror: new LocalNoteRepository(storage),
      now: tickingClock,
    });
    repo1.observeNotes(BOOK, () => {});
    await flush();
    await repo1.createNote(BOOK, { text: 'sopravvissuta al riavvio' });
    await flush();

    // launch 2: new repository + new mirror on the SAME storage, remote online
    const fake2 = fakeRemote();
    fake2.setOnline(true);
    const repo2 = new OfflineFirstNoteRepository({
      remote: fake2.remote,
      mirror: new LocalNoteRepository(storage),
      now: tickingClock,
    });
    const emissions: Note[][] = [];
    repo2.observeNotes(BOOK, (notes) => emissions.push(notes));
    await flush();
    await flush();

    // the note was there even before touching the remote, and is now synced
    expect(emissions.some((e) => e.some((n) => n.text === 'sopravvissuta al riavvio'))).toBe(true);
    expect([...fake2.store.values()].some((n) => n.text === 'sopravvissuta al riavvio')).toBe(true);
    expect(await new LocalNoteRepository(storage).listPending(BOOK)).toHaveLength(0);
  });

  it('online: creation reaches the remote without duplicates in the view', async () => {
    const { storage } = memoryStorage();
    const mirror = new LocalNoteRepository(storage);
    const fake = fakeRemote();
    fake.setOnline(true);

    const repo = new OfflineFirstNoteRepository({ remote: fake.remote, mirror, now: tickingClock });
    const emissions: Note[][] = [];
    repo.observeNotes(BOOK, (notes) => emissions.push(notes));
    await flush();
    await repo.createNote(BOOK, { text: 'idea online' });
    await flush();

    const last = emissions[emissions.length - 1];
    expect(last.filter((n) => n.text === 'idea online')).toHaveLength(1);
    expect(await mirror.listPending(BOOK)).toHaveLength(0);
  });

  it('deleteNote removes the note from the outbox and propagates it to the remote', async () => {
    const { storage } = memoryStorage();
    const mirror = new LocalNoteRepository(storage);
    const fake = fakeRemote(); // offline: the note stays in the outbox

    const repo = new OfflineFirstNoteRepository({ remote: fake.remote, mirror, now: tickingClock });
    repo.observeNotes(BOOK, () => {});
    await flush();
    const created = await repo.createNote(BOOK, { text: 'da cancellare' });
    await flush();
    expect(await mirror.listPending(BOOK)).toHaveLength(1);

    await repo.deleteNote({ bookId: BOOK, noteId: created.id });
    expect(await mirror.listPending(BOOK)).toHaveLength(0);
    expect(fake.remote.deleteNote).toHaveBeenCalledWith({ bookId: BOOK, noteId: created.id });
  });
});
