// Test delle security rules Firestore.
// Girano contro l'emulatore Firestore: `npm test` da rules-tests/ (avvia un
// emulatore effimero via scripts/test-rules.ps1), oppure `npm run test:jest`
// con gli emulatori già su.
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

// I PERMISSION_DENIED sono l'esito atteso dei test negativi: senza questo
// l'SDK riempie l'output di console.warn.
setLogLevel('error');

const OWNER = 'jane-uid';
const INTRUDER = 'intruso-uid';

// Una voce per ogni collezione dello schema, con percorso del proprietario,
// dati validi per la creazione e un aggiornamento innocuo.
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
    // l'update rispecchia il payload reale di updateNote: solo i campi cambiati
    // + updatedAt, SENZA rimandare schemaVersion (la guardia passa perché il
    // documento risultante lo conserva già dalla creazione).
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
  // Con `firebase emulators:exec` host e porta arrivano da FIRESTORE_EMULATOR_HOST;
  // il fallback serve per lanciare Jest a mano con gli emulatori già attivi.
  const fromEnv = process.env.FIRESTORE_EMULATOR_HOST;
  const [host, port] = fromEnv ? fromEnv.split(':') : ['127.0.0.1', '8080'];
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-bookvoice', // solo etichetta locale, come in .firebaserc
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
  // Semina tutti i documenti del proprietario bypassando le rules, così i test
  // di lettura/aggiornamento/cancellazione partono da uno stato realistico.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const f of FIXTURES) {
      await setDoc(doc(db, f.path(OWNER)), f.dati);
    }
  });
});

// RulesTestContext.firestore() è tipizzato con l'API compat, ma l'istanza è
// compatibile con le funzioni modulari (pattern della doc ufficiale): cast unico qui.
const ownerDb = (): Firestore =>
  testEnv.authenticatedContext(OWNER).firestore() as unknown as Firestore;
const intruderDb = (): Firestore =>
  testEnv.authenticatedContext(INTRUDER).firestore() as unknown as Firestore;
const anonDb = (): Firestore => testEnv.unauthenticatedContext().firestore() as unknown as Firestore;

describe.each(FIXTURES)('$nome', (f) => {
  const parentPath = (uid: string) => f.path(uid).split('/').slice(0, -1).join('/');

  test('il proprietario legge, crea, aggiorna, cancella e lista', async () => {
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, f.path(OWNER))));
    await assertSucceeds(setDoc(doc(db, `${parentPath(OWNER)}/nuovo`), f.dati));
    await assertSucceeds(updateDoc(doc(db, f.path(OWNER)), f.update));
    await assertSucceeds(getDocs(collection(db, parentPath(OWNER))));
    await assertSucceeds(deleteDoc(doc(db, f.path(OWNER))));
  });

  test('un utente autenticato DIVERSO è negato su tutto', async () => {
    const db = intruderDb();
    await assertFails(getDoc(doc(db, f.path(OWNER))));
    await assertFails(setDoc(doc(db, `${parentPath(OWNER)}/nuovo`), f.dati));
    await assertFails(updateDoc(doc(db, f.path(OWNER)), f.update));
    await assertFails(getDocs(collection(db, parentPath(OWNER))));
    await assertFails(deleteDoc(doc(db, f.path(OWNER))));
  });

  test('non autenticato è negato in lettura e scrittura', async () => {
    const db = anonDb();
    await assertFails(getDoc(doc(db, f.path(OWNER))));
    await assertFails(setDoc(doc(db, `${parentPath(OWNER)}/nuovo`), f.dati));
  });
});

describe('validazione schemaVersion (books, chapters e notes)', () => {
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

  test.each(CASI)('creazione $nome senza schemaVersion negata', async ({ path, dati }) => {
    await assertFails(setDoc(doc(ownerDb(), path), dati));
  });

  test.each(CASI)('creazione $nome con schemaVersion non intera negata', async ({ path, dati }) => {
    await assertFails(setDoc(doc(ownerDb(), path), { ...dati, schemaVersion: 'uno' }));
    await assertFails(setDoc(doc(ownerDb(), path), { ...dati, schemaVersion: 0 }));
  });

  test('un update non può rimuovere schemaVersion', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), `users/${OWNER}/books/libro1`), {
        schemaVersion: deleteField(),
      }),
    );
  });
});

describe('default deny fuori dallo schema', () => {
  test('collezione top-level estranea negata anche ad autenticati', async () => {
    const db = ownerDb();
    await assertFails(getDoc(doc(db, 'altraCollezione/doc1')));
    await assertFails(setDoc(doc(db, 'altraCollezione/doc1'), { a: 1 }));
  });

  test('collezione non prevista sotto users/{uid} negata anche al proprietario (fail-closed)', async () => {
    const db = ownerDb();
    await assertFails(setDoc(doc(db, `users/${OWNER}/nonPrevista/doc1`), { a: 1 }));
    await assertFails(getDoc(doc(db, `users/${OWNER}/nonPrevista/doc1`)));
  });

  test('il documento users/{uid} stesso non è né leggibile né scrivibile', async () => {
    const db = ownerDb();
    await assertFails(getDoc(doc(db, `users/${OWNER}`)));
    await assertFails(setDoc(doc(db, `users/${OWNER}`), { a: 1 }));
  });
});
