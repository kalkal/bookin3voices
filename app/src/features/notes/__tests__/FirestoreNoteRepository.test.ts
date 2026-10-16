// Targeted test of FirestoreNoteRepository: createNote
// writes `createdAt` as a CLIENT value (milliseconds), not serverTimestamp, so
// the note does not "jump" to the bottom under latency compensation (observeNotes orders by
// createdAt) and the value matches the optimistically returned note.
// The Firestore SDK is faked: only the payload passed to setDoc matters here.
// (jest.mock is hoisted by babel-jest above the imports: the order here is only aesthetic)

import * as firestore from 'firebase/firestore';

import { FirestoreNoteRepository } from '../FirestoreNoteRepository';

jest.mock('firebase/firestore', () => {
  let autoId = 0;
  const serverTimestampSentinel = { __sentinel: 'serverTimestamp' };
  return {
    __serverTimestampSentinel: serverTimestampSentinel,
    collection: (..._args: unknown[]) => ({ __col: true }),
    // doc(col) → minted id; doc(col, id) → passed id
    doc: (_col: unknown, id?: string) => ({ id: id ?? `auto-${(autoId += 1)}` }),
    deleteDoc: jest.fn(async () => {}),
    getDoc: jest.fn(),
    onSnapshot: jest.fn(),
    orderBy: jest.fn(),
    query: jest.fn(),
    serverTimestamp: () => serverTimestampSentinel,
    setDoc: jest.fn(async () => {}),
    updateDoc: jest.fn(async () => {}),
    // firestoreCodec does `value instanceof Timestamp`: a stub class is enough
    Timestamp: class {},
  };
});

const setDoc = firestore.setDoc as jest.Mock;
const serverTimestampSentinel = (firestore as unknown as { __serverTimestampSentinel: unknown })
  .__serverTimestampSentinel;

function makeRepo() {
  return new FirestoreNoteRepository({ db: {} as never, uid: 'jane' });
}

describe('FirestoreNoteRepository.createNote (client createdAt)', () => {
  beforeEach(() => {
    setDoc.mockClear();
  });

  it('writes createdAt as a client number, consistent with the returned note', async () => {
    const repo = makeRepo();
    const before = Date.now();
    const note = await repo.createNote('libro-1', { text: 'un’idea', tag: 'trama' });
    const after = Date.now();

    // the returned note has a numeric createdAt "now"
    expect(typeof note.createdAt).toBe('number');
    expect(note.createdAt).toBeGreaterThanOrEqual(before);
    expect(note.createdAt).toBeLessThanOrEqual(after);

    // the written document uses the SAME client value (no sentinel on createdAt)
    expect(setDoc).toHaveBeenCalledTimes(1);
    const written = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(written.createdAt).toBe(note.createdAt);
    expect(written.createdAt).not.toBe(serverTimestampSentinel);
    // updatedAt stays the authoritative server date
    expect(written.updatedAt).toBe(serverTimestampSentinel);
  });

  it('putNote rewrites with known id and createdAt (idempotent for recovery)', async () => {
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
