// Test mirato di FirestoreNoteRepository sul punto della review (F3): createNote
// scrive `createdAt` come valore CLIENT (millisecondi), non serverTimestamp, così
// la nota non "salta" in fondo sotto latency compensation (observeNotes ordina su
// createdAt) e il valore coincide con la nota restituita ottimisticamente.
// L'SDK Firestore è finto: qui interessa solo il payload passato a setDoc.
// (jest.mock è issato da babel-jest sopra gli import: l'ordine qui è solo estetico)

import * as firestore from 'firebase/firestore';

import { FirestoreNoteRepository } from '../FirestoreNoteRepository';

jest.mock('firebase/firestore', () => {
  let autoId = 0;
  const serverTimestampSentinel = { __sentinel: 'serverTimestamp' };
  return {
    __serverTimestampSentinel: serverTimestampSentinel,
    collection: (..._args: unknown[]) => ({ __col: true }),
    // doc(col) → id coniato; doc(col, id) → id passato
    doc: (_col: unknown, id?: string) => ({ id: id ?? `auto-${(autoId += 1)}` }),
    deleteDoc: jest.fn(async () => {}),
    getDoc: jest.fn(),
    onSnapshot: jest.fn(),
    orderBy: jest.fn(),
    query: jest.fn(),
    serverTimestamp: () => serverTimestampSentinel,
    setDoc: jest.fn(async () => {}),
    updateDoc: jest.fn(async () => {}),
    // firestoreCodec fa `value instanceof Timestamp`: basta una classe stub
    Timestamp: class {},
  };
});

const setDoc = firestore.setDoc as jest.Mock;
const serverTimestampSentinel = (firestore as unknown as { __serverTimestampSentinel: unknown })
  .__serverTimestampSentinel;

function makeRepo() {
  return new FirestoreNoteRepository({ db: {} as never, uid: 'jane' });
}

describe('FirestoreNoteRepository.createNote (F3: createdAt client)', () => {
  beforeEach(() => {
    setDoc.mockClear();
  });

  it('scrive createdAt come numero client, coerente con la nota restituita', async () => {
    const repo = makeRepo();
    const before = Date.now();
    const note = await repo.createNote('libro-1', { text: 'un’idea', tag: 'trama' });
    const after = Date.now();

    // la nota restituita ha un createdAt numerico "adesso"
    expect(typeof note.createdAt).toBe('number');
    expect(note.createdAt).toBeGreaterThanOrEqual(before);
    expect(note.createdAt).toBeLessThanOrEqual(after);

    // il documento scritto usa lo STESSO valore client (niente sentinel su createdAt)
    expect(setDoc).toHaveBeenCalledTimes(1);
    const written = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(written.createdAt).toBe(note.createdAt);
    expect(written.createdAt).not.toBe(serverTimestampSentinel);
    // updatedAt resta la data autorevole del server
    expect(written.updatedAt).toBe(serverTimestampSentinel);
  });

  it('putNote riscrive con id e createdAt noti (idempotente per la recovery)', async () => {
    const repo = makeRepo();
    await repo.putNote({
      id: 'nota-fissa',
      bookId: 'libro-1',
      schemaVersion: 1,
      text: 'ripescata',
      tag: null,
      createdAt: 1_757_000_000_000,
      updatedAt: 1_757_000_000_000,
    });
    expect(setDoc).toHaveBeenCalledTimes(1);
    const written = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(written.createdAt).toBe(1_757_000_000_000);
    expect(written.text).toBe('ripescata');
  });
});
