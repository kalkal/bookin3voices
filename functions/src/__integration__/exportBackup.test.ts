// Test d'integrazione della callable exportBackup contro
// l'emulatore Firestore (MAI progetti reali): si seminano due libri
// con capitoli via admin SDK, si invoca l'handler come farebbe la callable e
// si verificano:
//  - zip valido con un file per capitolo + indice per libro;
//  - Markdown FEDELE al rawText (accenti, virgolette «» e apostrofi tipografici);
//  - senza bookId si esportano TUTTI i libri, con bookId solo quello;
//  - idempotenza sul requestId: niente doppio registro exports;
//  - tetto sulla dimensione: oltre maxZipBytes errore chiaro che rimanda alla
//    variante Storage, senza registro orfano;
//  - errori chiari (auth, input, libro mancante, biblioteca vuota).

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import JSZip from 'jszip';

import { createExportBackupHandler, runExportBackup } from '../backup/exportBackup';
import type { ExportBackupResponse } from '../backup/types';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error(
    'Questi test girano SOLO contro l’emulatore Firestore (firebase emulators:exec).',
  );
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-functions';
const PROPOSTA_PENDING = 'PROPOSTA-PENDING-CHE-NON-DEVE-ENTRARE';

// testo con accenti, caporali e apostrofi tipografici: il backup deve
// restituirlo IDENTICO (fedeltà al testo grezzo)
const TESTO_CAP_1 = [
  'Il traghetto delle sette e un quarto attraccò con mezz’ora di ritardo.',
  'Diciassette anni senza mettere piede sull’isola: «un’eternità», avrebbe detto lo zio.',
  'Perché — si chiese — proprio adesso? Èva non l’avrebbe mai saputo…',
].join('\n');
const TESTO_CAP_2 = 'Il registro era lì: date, orari & coordinate <in codice>.';

let db: Firestore;

const NOW = 1788688800000; // orologio finto: 2026-09-06T10:00Z, createdAt deterministico

/** Semina la biblioteca: due libri, il secondo senza capitoli. */
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
  // suggerimento pending: il backup salva solo il rawText e DEVE ignorarlo
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

  // secondo libro, appena nato: nessun capitolo, deve comparire col solo indice
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
  if (file === null) throw new Error(`File assente nello zip: ${path}`);
  return file.async('string');
}

async function expectHttpsError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  db = getFirestore();
});

describe('exportBackup — tutta la biblioteca', () => {
  const uid = 'jane-backup-tutto';
  let response: ExportBackupResponse;
  let zip: JSZip;

  beforeAll(async () => {
    await seedLibrary(uid);
    response = await callBackup(uid, { requestId: 'bak-tutto-1' });
    zip = await unzip(response);
  });

  it('risponde con i metadati dello zip', () => {
    expect(response).toMatchObject({
      exportId: 'bak-tutto-1',
      fileName: 'backup-bookvoice-2026-09-06.zip',
      mimeType: 'application/zip',
      createdAt: NOW,
      bookCount: 2,
    });
    expect(response.size).toBe(Buffer.from(response.base64, 'base64').length);
  });

  it('contiene un indice e un file per capitolo, per ogni libro', () => {
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

  it('il Markdown del capitolo è FEDELE al rawText (accenti e virgolette)', async () => {
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

  it('l’indice del libro elenca metadati e capitoli', async () => {
    const indice = await fileText(zip, 'il-faro-di-levante/indice.md');
    expect(indice).toContain('# Il faro di Levante');
    expect(indice).toContain('- Autore: Jane Doe');
    expect(indice).toContain('1. [Il ritorno](01-il-ritorno.md) — draft, 30 parole');
    expect(indice).toContain('2. [Il registro](02-il-registro.md) — refined, 12 parole');
    const vuoto = await fileText(zip, 'quaderno-nuovo/indice.md');
    expect(vuoto).toContain('_Nessun capitolo ancora._');
  });

  it('registra il backup su users/{uid}/exports/{requestId} (senza Storage)', async () => {
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

  it('è idempotente: stesso requestId → stessi byte, nessun doppio registro', async () => {
    const retry = await callBackup(uid, { requestId: 'bak-tutto-1' });
    expect(retry.createdAt).toBe(NOW);
    expect(retry.base64).toBe(response.base64);
    const registry = await db.collection(`users/${uid}/exports`).get();
    expect(registry.size).toBe(1);
  });

  it('rifiuta il riuso del requestId per un backup diverso', async () => {
    await expectHttpsError(
      callBackup(uid, { bookId: 'libro-di-prova', requestId: 'bak-tutto-1' }),
      'already-exists',
    );
  });
});

describe('exportBackup — libro singolo', () => {
  const uid = 'jane-backup-uno';

  it('esporta solo il libro richiesto, con lo slug nel nome del file', async () => {
    const { mainBookId } = await seedLibrary(uid);
    const response = await callBackup(uid, { bookId: mainBookId, requestId: 'bak-uno-1' });
    expect(response.fileName).toBe('backup-il-faro-di-levante-2026-09-06.zip');
    expect(response.bookCount).toBe(1);
    const zip = await unzip(response);
    expect(zip.file('quaderno-nuovo/indice.md')).toBeNull();
    expect(zip.file('il-faro-di-levante/indice.md')).not.toBeNull();
  });
});

describe('exportBackup — tetto sulla dimensione', () => {
  const uid = 'jane-backup-tetto';

  it('oltre maxZipBytes: resource-exhausted con rimando alla variante su Storage, niente registro orfano', async () => {
    await seedLibrary(uid);
    await expectHttpsError(
      runExportBackup({ db, now: () => NOW, maxZipBytes: 64 }, uid, { requestId: 'bak-big-1' }),
      'resource-exhausted',
    );
    await expect(
      runExportBackup({ db, now: () => NOW, maxZipBytes: 64 }, uid, { requestId: 'bak-big-1' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('variante su Storage') });
    const registry = await db.collection(`users/${uid}/exports`).get();
    expect(registry.size).toBe(0);
  });
});

describe('exportBackup — errori', () => {
  const uid = 'jane-backup-errori';

  it('senza autenticazione: unauthenticated', async () => {
    const handler = createExportBackupHandler({ db });
    await expectHttpsError(handler(fakeRequest({ requestId: 'r1' })), 'unauthenticated');
  });

  it('input malformato: invalid-argument', async () => {
    await expectHttpsError(callBackup(uid, { requestId: 'niente spazi!' }), 'invalid-argument');
    await expectHttpsError(callBackup(uid, { bookId: '', requestId: 'r1' }), 'invalid-argument');
  });

  it('libro inesistente: not-found', async () => {
    await expectHttpsError(callBackup(uid, { bookId: 'non-esiste', requestId: 'r2' }), 'not-found');
  });

  it('biblioteca vuota: failed-precondition (niente registro orfano)', async () => {
    await expectHttpsError(callBackup(uid, { requestId: 'r3' }), 'failed-precondition');
    const registry = await db.collection(`users/${uid}/exports`).get();
    expect(registry.size).toBe(0);
  });
});
