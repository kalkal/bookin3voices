// Firestore security rules tests.
// They run against the Firestore emulator: `npm test` from rules-tests/ (starts
// an ephemeral emulator via scripts/test-rules.ps1), or `npm run test:jest`
// with the emulators already running.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  setLogLevel,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';

// PERMISSION_DENIED is the expected outcome of the negative tests: without this
// the SDK fills the output with console.warn.
setLogLevel('error');

const OWNER = 'jane-uid';
const INTRUDER = 'intruso-uid';

// One entry per schema collection, with the owner's path,
// valid data for creation and a harmless update.
type Fixture = {
  nome: string;
  path: (uid: string) => string;
  dati: Record<string, unknown>;
  update: Record<string, string | number>;
};

const FIXTURES: Fixture[] = [
  {
    nome: 'books',
    path: (uid) => `users/${uid}/books/libro1`,
    dati: { schemaVersion: 1, title: 'Prova', status: 'draft' },
    update: { schemaVersion: 1, title: 'Prova rivista' },
  },
  {
    nome: 'chapters',
    path: (uid) => `users/${uid}/books/libro1/chapters/cap1`,
    dati: { schemaVersion: 1, order: 1, rawText: 'Testo fittizio.', status: 'draft' },
    update: { schemaVersion: 1, rawText: 'Testo fittizio rivisto.' },
  },
  {
    nome: 'sessions',
    path: (uid) => `users/${uid}/books/libro1/chapters/cap1/sessions/sess1`,
    dati: { startedAt: 1, endedAt: 2, wordsAdded: 42 },
    update: { wordsAdded: 43 },
  },
  {
    nome: 'suggestions',
    path: (uid) => `users/${uid}/books/libro1/chapters/cap1/suggestions/sug1`,
    dati: { kind: 'style', state: 'pending', original: 'frase', proposals: ['variante'] },
    update: { state: 'accepted' },
  },
  {
    nome: 'revisions',
    path: (uid) => `users/${uid}/books/libro1/chapters/cap1/revisions/rev1`,
    dati: { before: 'a', after: 'b', decision: 'accepted', at: 1 },
    update: { decision: 'rejected' },
  },
  {
    nome: 'notes',
    // the update mirrors the real updateNote payload: only the changed fields
    // + updatedAt, WITHOUT resending schemaVersion (the guard passes because the
    // resulting document already keeps it from creation).
    path: (uid) => `users/${uid}/books/libro1/notes/nota1`,
    dati: { schemaVersion: 1, text: 'Un’idea a lato', tag: 'trama', createdAt: 1, updatedAt: 1 },
    update: { text: 'Idea rivista', updatedAt: 2 },
  },
  {
    nome: 'settings',
    path: (uid) => `users/${uid}/settings/app`,
    dati: { aiProvider: 'gemini', theme: 'library' },
    update: { theme: 'dark' },
  },
  {
    nome: 'styleProfiles',
    path: (uid) => `users/${uid}/styleProfiles/suspense`,
    dati: { name: 'Suspense/Horror', styleBible: 'testo lungo', fewShots: [] },
    update: { styleBible: 'testo più lungo' },
  },
  {
    nome: 'exports',
    path: (uid) => `users/${uid}/exports/exp1`,
    dati: { bookId: 'libro1', format: 'epub', storagePath: 'x', createdAt: 1 },
    update: { format: 'docx' },
  },
];

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  // With `firebase emulators:exec` host and port come from FIRESTORE_EMULATOR_HOST;
  // the fallback is for launching Jest by hand with the emulators already running.
  const fromEnv = process.env.FIRESTORE_EMULATOR_HOST;
  const [host, port] = fromEnv ? fromEnv.split(':') : ['127.0.0.1', '8080'];
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-bookvoice', // local label only, as in .firebaserc
    firestore: {
      rules: readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seeds all of the owner's documents bypassing the rules, so the
  // read/update/delete tests start from a realistic state.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const f of FIXTURES) {
      await setDoc(doc(db, f.path(OWNER)), f.dati);
    }
  });
});

// RulesTestContext.firestore() is typed with the compat API, but the instance is
// compatible with the modular functions (official docs pattern): single cast here.
const ownerDb = (): Firestore =>
  testEnv.authenticatedContext(OWNER).firestore() as unknown as Firestore;
const intruderDb = (): Firestore =>
  testEnv.authenticatedContext(INTRUDER).firestore() as unknown as Firestore;
const anonDb = (): Firestore => testEnv.unauthenticatedContext().firestore() as unknown as Firestore;

describe.each(FIXTURES)('$nome', (f) => {
  const parentPath = (uid: string) => f.path(uid).split('/').slice(0, -1).join('/');

  test('the owner reads, creates, updates, deletes and lists', async () => {
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, f.path(OWNER))));
    await assertSucceeds(setDoc(doc(db, `${parentPath(OWNER)}/nuovo`), f.dati));
    await assertSucceeds(updateDoc(doc(db, f.path(OWNER)), f.update));
    await assertSucceeds(getDocs(collection(db, parentPath(OWNER))));
    await assertSucceeds(deleteDoc(doc(db, f.path(OWNER))));
  });

  test('a DIFFERENT authenticated user is denied everything', async () => {
    const db = intruderDb();
    await assertFails(getDoc(doc(db, f.path(OWNER))));
    await assertFails(setDoc(doc(db, `${parentPath(OWNER)}/nuovo`), f.dati));
    await assertFails(updateDoc(doc(db, f.path(OWNER)), f.update));
    await assertFails(getDocs(collection(db, parentPath(OWNER))));
    await assertFails(deleteDoc(doc(db, f.path(OWNER))));
  });

  test('unauthenticated is denied read and write', async () => {
    const db = anonDb();
    await assertFails(getDoc(doc(db, f.path(OWNER))));
    await assertFails(setDoc(doc(db, `${parentPath(OWNER)}/nuovo`), f.dati));
  });
});

describe('schemaVersion validation (books, chapters and notes)', () => {
  const CASI = [
    { nome: 'book', path: `users/${OWNER}/books/senza-versione`, dati: { title: 'x' } },
    {
      nome: 'chapter',
      path: `users/${OWNER}/books/libro1/chapters/senza-versione`,
      dati: { rawText: 'x' },
    },
    {
      nome: 'note',
      path: `users/${OWNER}/books/libro1/notes/senza-versione`,
      dati: { text: 'x' },
    },
  ];

  test.each(CASI)('creating $nome without schemaVersion is denied', async ({ path, dati }) => {
    await assertFails(setDoc(doc(ownerDb(), path), dati));
  });

  test.each(CASI)('creating $nome with a non-integer schemaVersion is denied', async ({ path, dati }) => {
    await assertFails(setDoc(doc(ownerDb(), path), { ...dati, schemaVersion: 'uno' }));
    await assertFails(setDoc(doc(ownerDb(), path), { ...dati, schemaVersion: 0 }));
  });

  test('an update cannot remove schemaVersion', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), `users/${OWNER}/books/libro1`), {
        schemaVersion: deleteField(),
      }),
    );
  });
});

describe('default deny outside the schema', () => {
  test('foreign top-level collection denied even to authenticated users', async () => {
    const db = ownerDb();
    await assertFails(getDoc(doc(db, 'altraCollezione/doc1')));
    await assertFails(setDoc(doc(db, 'altraCollezione/doc1'), { a: 1 }));
  });

  test('unexpected collection under users/{uid} denied even to the owner (fail-closed)', async () => {
    const db = ownerDb();
    await assertFails(setDoc(doc(db, `users/${OWNER}/nonPrevista/doc1`), { a: 1 }));
    await assertFails(getDoc(doc(db, `users/${OWNER}/nonPrevista/doc1`)));
  });

  test('the users/{uid} document itself is neither readable nor writable', async () => {
    const db = ownerDb();
    await assertFails(getDoc(doc(db, `users/${OWNER}`)));
    await assertFails(setDoc(doc(db, `users/${OWNER}`), { a: 1 }));
  });
});
