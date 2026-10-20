/**
 * Integration test of FirestoreNoteRepository (Notebook feature) against
 * the EMULATOR (never real projects), with the repo's REAL RULES
 * (firestore.rules): besides the repository behavior, this checks that
 * every write respects the rules' shape validations (schemaVersion on
 * create/update) for the notes subcollection. The demo-* projectId guarantees
 * that no call reaches the cloud.
 *
 * ENVIRONMENT NOTE: on some machines the emulator may fail to start (Defender
 * blocks loopback). The test is written regardless and runs in CI / wherever
 * the emulator is available: `npm run test:integration` from app/.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, waitForPendingWrites, type Firestore } from 'firebase/firestore';

import { FirestoreNoteRepository } from '../features/notes/FirestoreNoteRepository';
import type { Note } from '../features/notes/types';

const PROJECT_ID = 'demo-bookvoice-notes';
const UID = 'jane-test';
const BOOK = 'libro-1';

const RULES = readFileSync(join(__dirname, '..', '..', '..', 'firestore.rules'), 'utf8');

function emulatorHostAndPort(): { host: string; port: number } {
  const fromEnv = process.env.FIRESTORE_EMULATOR_HOST;
  if (fromEnv !== undefined && fromEnv.includes(':')) {
    const [host, port] = fromEnv.split(':');
    return { host, port: Number(port) };
  }
  return { host: '127.0.0.1', port: 8080 };
}

let env: RulesTestEnvironment;
let db: Firestore;

/** Waits for a condition on the observe stream to become true. */
function waitUntil<T>(
  subscribe: (onChange: (value: T) => void) => () => void,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for: ${label}`));
    }, timeoutMs);
    const unsubscribe = subscribe((value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    });
  });
}

function makeRepo(onWriteError?: (error: Error) => void) {
  return new FirestoreNoteRepository({ db, uid: UID, onWriteError });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { ...emulatorHostAndPort(), rules: RULES },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  db = env.authenticatedContext(UID).firestore() as unknown as Firestore;
});

afterEach(async () => {
  await waitForPendingWrites(db).catch(() => {});
});

afterAll(async () => {
  await env.cleanup();
});

describe('FirestoreNoteRepository', () => {
  it('createNote writes a schema-conforming document and observeNotes emits it', async () => {
    const repo = makeRepo();
    const created = await repo.createNote(BOOK, {
      text: 'E se il mulino fosse la prigione?',
      tag: 'trama',
    });
    expect(created).toMatchObject({
      text: 'E se il mulino fosse la prigione?',
      tag: 'trama',
      bookId: BOOK,
    });

    const notes = await waitUntil<Note[]>(
      (cb) => repo.observeNotes(BOOK, cb),
      (list) => list.length === 1,
      'observeNotes emits the created note',
    );
    expect(notes[0]).toMatchObject({ id: created.id, text: 'E se il mulino fosse la prigione?' });

    await waitForPendingWrites(db);
    const fetched = await repo.getNote({ bookId: BOOK, noteId: created.id });
    expect(fetched).toMatchObject({ schemaVersion: 1, tag: 'trama' });
    expect(typeof fetched?.createdAt).toBe('number');
  });

  it('observeNotes orders by createdAt descending (newest first)', async () => {
    const repo = makeRepo();
    await repo.createNote(BOOK, { text: 'prima' });
    await waitForPendingWrites(db);
    await repo.createNote(BOOK, { text: 'seconda' });
    await waitForPendingWrites(db);
    await repo.createNote(BOOK, { text: 'terza' });

    const notes = await waitUntil<Note[]>(
      (cb) => repo.observeNotes(BOOK, cb),
      (list) => list.length === 3,
      'observeNotes emits the three notes',
    );
    expect(notes.map((n) => n.text)).toEqual(['terza', 'seconda', 'prima']);
  });

  it('updateNote changes text/tags; deleteNote removes the note', async () => {
    const repo = makeRepo();
    const created = await repo.createNote(BOOK, { text: 'bozza', tag: null });
    await waitForPendingWrites(db);
    await repo.updateNote({ bookId: BOOK, noteId: created.id }, { text: 'rivista', tag: 'dubbio' });
    await waitForPendingWrites(db);
    expect(await repo.getNote({ bookId: BOOK, noteId: created.id })).toMatchObject({
      text: 'rivista',
      tag: 'dubbio',
    });

    await repo.deleteNote({ bookId: BOOK, noteId: created.id });
    await waitForPendingWrites(db);
    expect(await repo.getNote({ bookId: BOOK, noteId: created.id })).toBeNull();
  });

  it('getNote throws on a broken document (never confuse empty with broken)', async () => {
    const repo = makeRepo();
    await setDoc(doc(db, 'users', UID, 'books', BOOK, 'notes', 'rotto'), {
      schemaVersion: 1,
      text: 42,
    });
    await expect(repo.getNote({ bookId: BOOK, noteId: 'rotto' })).rejects.toThrow(
      /does not match the schema/,
    );
  });

  it('per-user rules: another user cannot read Jane’s notes', async () => {
    const repo = makeRepo();
    const created = await repo.createNote(BOOK, { text: 'privata' });
    await waitForPendingWrites(db);
    const intruso = env.authenticatedContext('altro-utente').firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(intruso, 'users', UID, 'books', BOOK, 'notes', created.id)));
  });
});
