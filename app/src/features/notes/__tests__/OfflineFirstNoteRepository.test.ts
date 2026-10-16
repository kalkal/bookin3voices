// Regole del composito offline-first delle note (review F2): l'outbox durabile
// prima di Firestore, la nota che compare anche quando il remoto rifiuta, la
// recovery al ritorno del remoto e la sopravvivenza dell'outbox al riavvio
// dell'app (nuovo repository sullo STESSO storage).

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
 * Remote finto = un mini-Firestore in memoria con un interruttore `online`.
 * Offline: putNote rifiuta (come una scrittura non consegnata) e observe non
 * emette la nota. Online: putNote memorizza ed emette. newNoteId conia id unici.
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

/** Attende che i microtask della coda (putNote in background) si svuotino. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let clock = 1000;
const tickingClock = () => (clock += 1);

beforeEach(() => {
  clock = 1000;
});

describe('OfflineFirstNoteRepository', () => {
  it('crea offline: la nota è nell’outbox durabile e compare, benché il remoto rifiuti', async () => {
    const { storage } = memoryStorage();
    const mirror = new LocalNoteRepository(storage);
    const { remote } = fakeRemote(); // resta offline

    const repo = new OfflineFirstNoteRepository({ remote, mirror, now: tickingClock });
    const emissions: Note[][] = [];
    repo.observeNotes(BOOK, (notes) => emissions.push(notes));
    await flush();

    const created = await repo.createNote(BOOK, { text: 'idea offline', tag: 'trama' });
    await flush();

    // outbox durabile: la nota è su "disco"
    expect(await mirror.listPending(BOOK)).toEqual([expect.objectContaining({ id: created.id })]);
    // e compare nella vista, pur avendo il remoto rifiutato la scrittura
    const last = emissions[emissions.length - 1];
    expect(last.map((n) => n.text)).toContain('idea offline');
    expect(remote.putNote).toHaveBeenCalled();
  });

  it('quando il remoto torna, la recovery ri-sincronizza e svuota l’outbox', async () => {
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

    // il remoto torna: riaprendo il Taccuino (nuova observe) parte la recovery
    fake.setOnline(true);
    const emissions: Note[][] = [];
    repo.observeNotes(BOOK, (notes) => emissions.push(notes));
    await flush();
    await flush();

    // la nota è ora sul remoto e l'outbox è vuoto (stesso id, niente doppioni)
    expect(fake.store.has(`${BOOK}/${created.id}`)).toBe(true);
    expect(await mirror.listPending(BOOK)).toHaveLength(0);
    const last = emissions[emissions.length - 1];
    expect(last.filter((n) => n.text === 'da sincronizzare')).toHaveLength(1);
  });

  it('app riavviata: l’outbox su disco sopravvive e la nota si sincronizza al ritorno online', async () => {
    const { storage } = memoryStorage(); // storage condiviso tra i due "avvii"

    // avvio 1: offline, si crea una nota; il repository muore con l'app
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

    // avvio 2: nuovo repository + nuovo mirror sullo STESSO storage, remoto online
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

    // la nota c'era anche prima di toccare il remoto, e ora è sincronizzata
    expect(emissions.some((e) => e.some((n) => n.text === 'sopravvissuta al riavvio'))).toBe(true);
    expect([...fake2.store.values()].some((n) => n.text === 'sopravvissuta al riavvio')).toBe(true);
    expect(await new LocalNoteRepository(storage).listPending(BOOK)).toHaveLength(0);
  });

  it('online: la creazione arriva al remoto senza duplicati nella vista', async () => {
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

  it('deleteNote toglie la nota dall’outbox e la propaga al remoto', async () => {
    const { storage } = memoryStorage();
    const mirror = new LocalNoteRepository(storage);
    const fake = fakeRemote(); // offline: la nota resta in outbox

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
