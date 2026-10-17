// Integration test of the exportBackup callable against the
// Firestore emulator (NEVER real projects): two books are seeded
// with chapters via the admin SDK, the handler is invoked as the callable would
// invoke it, and the following is verified:
//  - valid zip with one file per chapter + an index per book;
//  - Markdown FAITHFUL to rawText (accents, «» quotes and typographic apostrophes);
//  - without bookId ALL books are exported, with bookId only that one;
//  - idempotency on requestId: no duplicate exports registry entry;
//  - size cap: above maxZipBytes a clear error pointing to the
//    Storage variant, with no orphaned registry entry;
//  - clear errors (auth, input, missing book, empty library).

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import JSZip from 'jszip';

import { createExportBackupHandler, runExportBackup } from '../backup/exportBackup';
import type { ExportBackupResponse } from '../backup/types';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error('These tests run ONLY against the Firestore emulator (firebase emulators:exec).');
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-functions';
const PROPOSTA_PENDING = 'PROPOSTA-PENDING-CHE-NON-DEVE-ENTRARE';

// text with accents, guillemets and typographic apostrophes: the backup must
// return it IDENTICAL (fidelity to the raw text)
const TESTO_CAP_1 = [
  'Il traghetto delle sette e un quarto attraccò con mezz’ora di ritardo.',
  'Diciassette anni senza mettere piede sull’isola: «un’eternità», avrebbe detto lo zio.',
  'Perché — si chiese — proprio adesso? Èva non l’avrebbe mai saputo…',
].join('\n');
const TESTO_CAP_2 = 'Il registro era lì: date, orari & coordinate <in codice>.';

let db: Firestore;

const NOW = 1788688800000; // fake clock: 2026-09-06T10:00Z, deterministic createdAt

/** Seeds the library: two books, the second without chapters. */
async function seedLibrary(uid: string): Promise<{ mainBookId: string }> {
  const mainBookId = 'libro-di-prova';
  const bookRef = db.doc(`users/${uid}/books/${mainBookId}`);
  await bookRef.set({
    schemaVersion: 1,
    title: 'Il faro di Levante',
    author: 'Jane Doe',
    description: 'Nora Ferrandi eredita un faro e il segreto che custodiva.',
    synopsis: '',
    genre: 'romanzo',
    language: 'it',
    status: 'draft',
    styleProfileId: null,
    wordCount: 42,
    chapterCount: 2,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await bookRef.collection('chapters').doc('cap-1').set({
    schemaVersion: 1,
    order: 0,
    title: 'Il ritorno',
    status: 'draft',
    wordCount: 30,
    rawText: TESTO_CAP_1,
    updatedAt: NOW,
  });
  await bookRef.collection('chapters').doc('cap-2').set({
    schemaVersion: 1,
    order: 1,
    title: 'Il registro',
    status: 'refined',
    wordCount: 12,
    rawText: TESTO_CAP_2,
    updatedAt: NOW,
  });
  // pending suggestion: the backup stores only rawText and MUST ignore it
  await bookRef
    .collection('chapters')
    .doc('cap-1')
    .collection('suggestions')
    .doc('sug-1')
    .set({
      id: 'sug-1',
      kind: 'style',
      span: { from: 0, to: 12 },
      original: 'Il traghetto',
      proposals: [PROPOSTA_PENDING],
      rationale: 'prova',
      state: 'pending',
      textHash: 'hash-di-prova',
    });

  // second book, just created: no chapters, must appear with the index only
  await db.doc(`users/${uid}/books/quaderno-nuovo`).set({
    schemaVersion: 1,
    title: 'Quaderno nuovo',
    author: 'Jane Doe',
    description: '',
    synopsis: '',
    genre: 'appunti',
    language: 'it',
    status: 'draft',
    styleProfileId: null,
    wordCount: 0,
    chapterCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  return { mainBookId };
}

function fakeRequest(data: unknown, uid?: string): CallableRequest<unknown> {
  return { data, auth: uid === undefined ? undefined : { uid } } as CallableRequest<unknown>;
}

async function callBackup(uid: string, data: unknown): Promise<ExportBackupResponse> {
  const handler = createExportBackupHandler({ db, now: () => NOW });
  return handler(fakeRequest(data, uid));
}

async function unzip(response: ExportBackupResponse): Promise<JSZip> {
  return JSZip.loadAsync(Buffer.from(response.base64, 'base64'));
}

async function fileText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (file === null) throw new Error(`File missing from the zip: ${path}`);
  return file.async('string');
}

async function expectHttpsError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  db = getFirestore();
});

describe('exportBackup — whole library', () => {
  const uid = 'jane-backup-tutto';
  let response: ExportBackupResponse;
  let zip: JSZip;

  beforeAll(async () => {
    await seedLibrary(uid);
    response = await callBackup(uid, { requestId: 'bak-tutto-1' });
    zip = await unzip(response);
  });

  it('responds with the zip metadata', () => {
    expect(response).toMatchObject({
      exportId: 'bak-tutto-1',
      fileName: 'backup-bookvoice-2026-09-06.zip',
      mimeType: 'application/zip',
      createdAt: NOW,
      bookCount: 2,
    });
    expect(response.size).toBe(Buffer.from(response.base64, 'base64').length);
  });

  it('contains an index and one file per chapter, for each book', () => {
    expect(
      Object.keys(zip.files)
        .filter((name) => !zip.files[name]?.dir)
        .sort(),
    ).toEqual([
      'il-faro-di-levante/01-il-ritorno.md',
      'il-faro-di-levante/02-il-registro.md',
      'il-faro-di-levante/indice.md',
      'quaderno-nuovo/indice.md',
    ]);
  });

  it('pins every entry date, folders included, to createdAt (deterministic bytes)', () => {
    const entries = Object.values(zip.files);
    expect(entries.some((entry) => entry.dir)).toBe(true);
    for (const entry of entries) {
      expect({ name: entry.name, date: entry.date.getTime() }).toEqual({
        name: entry.name,
        date: NOW,
      });
    }
  });

  it('the chapter Markdown is FAITHFUL to rawText (accents and quotes)', async () => {
    const md = await fileText(zip, 'il-faro-di-levante/01-il-ritorno.md');
    expect(md).toBe(
      [
        '---',
        'titolo: "Il ritorno"',
        'ordine: 1',
        'stato: "draft"',
        'parole: 30',
        '---',
        '',
        `${TESTO_CAP_1}\n`,
      ].join('\n'),
    );
    expect(md).not.toContain(PROPOSTA_PENDING);
  });

  it('the book index lists metadata and chapters', async () => {
    const indice = await fileText(zip, 'il-faro-di-levante/indice.md');
    expect(indice).toContain('# Il faro di Levante');
    expect(indice).toContain('- Autore: Jane Doe');
    expect(indice).toContain('1. [Il ritorno](01-il-ritorno.md) — draft, 30 parole');
    expect(indice).toContain('2. [Il registro](02-il-registro.md) — refined, 12 parole');
    const vuoto = await fileText(zip, 'quaderno-nuovo/indice.md');
    expect(vuoto).toContain('_Nessun capitolo ancora._');
  });

  it('records the backup at users/{uid}/exports/{requestId} (without Storage)', async () => {
    const registry = await db.doc(`users/${uid}/exports/bak-tutto-1`).get();
    expect(registry.data()).toMatchObject({
      schemaVersion: 1,
      format: 'backup-md',
      bookId: null,
      storagePath: null,
      createdAt: NOW,
      fileName: 'backup-bookvoice-2026-09-06.zip',
      size: response.size,
    });
  });

  it('is idempotent: same requestId → same bytes, no duplicate registry entry', async () => {
    const retry = await callBackup(uid, { requestId: 'bak-tutto-1' });
    expect(retry.createdAt).toBe(NOW);
    expect(retry.base64).toBe(response.base64);
    const registry = await db.collection(`users/${uid}/exports`).get();
    expect(registry.size).toBe(1);
  });

  it('rejects reuse of the requestId for a different backup', async () => {
    await expectHttpsError(
      callBackup(uid, { bookId: 'libro-di-prova', requestId: 'bak-tutto-1' }),
      'already-exists',
    );
  });
});

describe('exportBackup — single book', () => {
  const uid = 'jane-backup-uno';

  it('exports only the requested book, with the slug in the file name', async () => {
    const { mainBookId } = await seedLibrary(uid);
    const response = await callBackup(uid, { bookId: mainBookId, requestId: 'bak-uno-1' });
    expect(response.fileName).toBe('backup-il-faro-di-levante-2026-09-06.zip');
    expect(response.bookCount).toBe(1);
    const zip = await unzip(response);
    expect(zip.file('quaderno-nuovo/indice.md')).toBeNull();
    expect(zip.file('il-faro-di-levante/indice.md')).not.toBeNull();
  });
});

describe('exportBackup — size cap', () => {
  const uid = 'jane-backup-tetto';

  it('above maxZipBytes: resource-exhausted pointing to the Storage variant, no orphaned registry entry', async () => {
    await seedLibrary(uid);
    await expectHttpsError(
      runExportBackup({ db, now: () => NOW, maxZipBytes: 64 }, uid, { requestId: 'bak-big-1' }),
      'resource-exhausted',
    );
    await expect(
      runExportBackup({ db, now: () => NOW, maxZipBytes: 64 }, uid, { requestId: 'bak-big-1' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Storage') });
    const registry = await db.collection(`users/${uid}/exports`).get();
    expect(registry.size).toBe(0);
  });
});

describe('exportBackup — errors', () => {
  const uid = 'jane-backup-errori';

  it('without authentication: unauthenticated', async () => {
    const handler = createExportBackupHandler({ db });
    await expectHttpsError(handler(fakeRequest({ requestId: 'r1' })), 'unauthenticated');
  });

  it('malformed input: invalid-argument', async () => {
    await expectHttpsError(callBackup(uid, { requestId: 'niente spazi!' }), 'invalid-argument');
    await expectHttpsError(callBackup(uid, { bookId: '', requestId: 'r1' }), 'invalid-argument');
  });

  it('nonexistent book: not-found', async () => {
    await expectHttpsError(callBackup(uid, { bookId: 'non-esiste', requestId: 'r2' }), 'not-found');
  });

  it('empty library: failed-precondition (no orphaned registry entry)', async () => {
    await expectHttpsError(callBackup(uid, { requestId: 'r3' }), 'failed-precondition');
    const registry = await db.collection(`users/${uid}/exports`).get();
    expect(registry.size).toBe(0);
  });
});
