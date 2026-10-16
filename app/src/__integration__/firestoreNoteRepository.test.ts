/**
 * Test d'integrazione del FirestoreNoteRepository (feature Taccuino) contro
 * l'EMULATORE (mai progetti reali), con le REGOLE VERE del repo
 * (firestore.rules): oltre al comportamento del repository si verifica così che
 * ogni scrittura rispetti le validazioni di forma delle rules (schemaVersion su
 * create/update) per la sottocollezione notes. Il projectId demo-* garantisce
 * che nessuna chiamata raggiunga il cloud.
 *
 * NOTA AMBIENTE: su questa macchina l'emulatore può non partire (Defender
 * blocca il loopback). Il test è comunque scritto e gira in CI / dove
 * l'emulatore è disponibile: `npm run test:integration` da app/.
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

/** Attende che una condizione sull'observe diventi vera. */
function waitUntil<T>(
  subscribe: (onChange: (value: T) => void) => () => void,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timeout in attesa di: ${label}`));
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
  it('createNote scrive un documento conforme allo schema e observeNotes lo emette', async () => {
    const repo = makeRepo();
    const created = await repo.createNote(BOOK, {
      text: 'E se il faro fosse la prigione?',
      tag: 'trama',
    });
    expect(created).toMatchObject({
      text: 'E se il faro fosse la prigione?',
      tag: 'trama',
      bookId: BOOK,
    });

    const notes = await waitUntil<Note[]>(
      (cb) => repo.observeNotes(BOOK, cb),
      (list) => list.length === 1,
      'observeNotes emette la nota creata',
    );
    expect(notes[0]).toMatchObject({ id: created.id, text: 'E se il faro fosse la prigione?' });

    await waitForPendingWrites(db);
    const fetched = await repo.getNote({ bookId: BOOK, noteId: created.id });
    expect(fetched).toMatchObject({ schemaVersion: 1, tag: 'trama' });
    expect(typeof fetched?.createdAt).toBe('number');
  });

  it('observeNotes ordina per createdAt discendente (più recenti in cima)', async () => {
    const repo = makeRepo();
    await repo.createNote(BOOK, { text: 'prima' });
    await waitForPendingWrites(db);
    await repo.createNote(BOOK, { text: 'seconda' });
    await waitForPendingWrites(db);
    await repo.createNote(BOOK, { text: 'terza' });

    const notes = await waitUntil<Note[]>(
      (cb) => repo.observeNotes(BOOK, cb),
      (list) => list.length === 3,
      'observeNotes emette le tre note',
    );
    expect(notes.map((n) => n.text)).toEqual(['terza', 'seconda', 'prima']);
  });

  it('updateNote cambia testo/tag; deleteNote toglie la nota', async () => {
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

  it('getNote lancia su documento rotto (mai confondere vuoto con rotto)', async () => {
    const repo = makeRepo();
    await setDoc(doc(db, 'users', UID, 'books', BOOK, 'notes', 'rotto'), {
      schemaVersion: 1,
      text: 42,
    });
    await expect(repo.getNote({ bookId: BOOK, noteId: 'rotto' })).rejects.toThrow(/non conforme/);
  });

  it('regole per-utente: un altro utente non legge le note di Jane', async () => {
    const repo = makeRepo();
    const created = await repo.createNote(BOOK, { text: 'privata' });
    await waitForPendingWrites(db);
    const intruso = env.authenticatedContext('altro-utente').firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(intruso, 'users', UID, 'books', BOOK, 'notes', created.id)));
  });
});
