// Integration test of the exportBook callable against the
// Firestore emulator (NEVER real projects): a book, its chapters and a
// pending suggestion are seeded via the admin SDK, the handler is invoked as
// the callable would invoke it, and the following is verified:
//  - KDP-valid EPUB: EPUBCheck with no errors or warnings (acceptance criterion);
//  - openable DOCX (OOXML structure);
//  - pending suggestions IGNORED: the proposed text does not get in;
//  - idempotency on requestId: no duplicate exports registry entry;
//  - clear errors (auth, input, missing book, empty book).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import JSZip from 'jszip';

import { createExportBookHandler, runExportBook } from '../export/exportBook';
import type { ExportBookResponse } from '../export/types';
import { runEpubcheck } from './epubcheck';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error('These tests run ONLY against the Firestore emulator (firebase emulators:exec).');
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-functions';
const PROPOSTA_PENDING = 'PROPOSTA-PENDING-CHE-NON-DEVE-ENTRARE';

let db: Firestore;

const NOW = 1757150000000; // fake clock: deterministic createdAt

interface SeedOptions {
  chapters?: boolean;
}

/** Seeds a complete book (per the schema) under a uid dedicated to the test. */
async function seedBook(uid: string, { chapters = true }: SeedOptions = {}): Promise<string> {
  const bookId = 'libro-di-prova';
  const bookRef = db.doc(`users/${uid}/books/${bookId}`);
  await bookRef.set({
    schemaVersion: 1,
    title: 'Il mulino di Rocca Bassa',
    author: 'Jane Doe',
    description: 'Viola rileva le arnie di un mulino e il segreto che custodivano.',
    synopsis: '',
    genre: 'romanzo',
    language: 'it',
    status: 'draft',
    styleProfileId: null,
    wordCount: 42,
    chapterCount: chapters ? 3 : 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  if (!chapters) return bookId;

  const testo1 = [
    'La corriera delle sette e un quarto arrivò in valle con mezz’ora di ritardo.',
    'Viola scese in piazza con una valigia troppo pesante — e la sensazione, netta, di aver sbagliato tutto.',
    'Diciassette anni senza mettere piede nella valle: «un’eternità», avrebbe detto Olga.',
  ].join('\n');
  const testo2 = 'Il registro era lì: date, orari & coordinate <in codice>.';
  await bookRef.collection('chapters').doc('cap-1').set({
    schemaVersion: 1,
    order: 0,
    title: 'Il ritorno',
    status: 'draft',
    wordCount: 30,
    rawText: testo1,
    updatedAt: NOW,
  });
  await bookRef.collection('chapters').doc('cap-2').set({
    schemaVersion: 1,
    order: 1,
    title: 'Il registro',
    status: 'draft',
    wordCount: 12,
    rawText: testo2,
    updatedAt: NOW,
  });
  // still-empty chapter: must appear in the book with the title only
  await bookRef.collection('chapters').doc('cap-3').set({
    schemaVersion: 1,
    order: 2,
    title: 'Il terzo giovedì',
    status: 'draft',
    wordCount: 0,
    rawText: '',
    updatedAt: NOW,
  });
  // pending suggestion: the export MUST ignore it
  await bookRef
    .collection('chapters')
    .doc('cap-1')
    .collection('suggestions')
    .doc('sug-1')
    .set({
      id: 'sug-1',
      kind: 'style',
      span: { from: 0, to: 11 },
      original: 'La corriera',
      proposals: [PROPOSTA_PENDING],
      rationale: 'prova',
      state: 'pending',
      textHash: 'hash-di-prova',
    });
  return bookId;
}

function fakeRequest(data: unknown, uid?: string): CallableRequest<unknown> {
  return { data, auth: uid === undefined ? undefined : { uid } } as CallableRequest<unknown>;
}

async function callExport(uid: string, data: unknown): Promise<ExportBookResponse> {
  const handler = createExportBookHandler({ db, now: () => NOW });
  return handler(fakeRequest(data, uid));
}

async function expectHttpsError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  db = getFirestore();
});

describe('exportBook — EPUB of a book with no author name', () => {
  it('still passes EPUBCheck, with no invented "anonymous"', async () => {
    const uid = 'jane-epub-senza-autore';
    const bookId = await seedBook(uid);
    await db.doc(`users/${uid}/books/${bookId}`).update({ author: '' });
    const response = await callExport(uid, { bookId, format: 'epub', requestId: 'req-epub-na' });
    const epub = Buffer.from(response.base64, 'base64');
    const zip = await JSZip.loadAsync(epub);
    const opfFile = Object.keys(zip.files).find((name) => name.endsWith('.opf'));
    expect(await zip.file(opfFile as string)?.async('string')).not.toContain('anonymous');

    const dir = mkdtempSync(join(tmpdir(), 'bookvoice-export-'));
    const file = join(dir, response.fileName);
    writeFileSync(file, epub);
    const result = runEpubcheck(file);
    expect(`${result.status}\n${result.output}`).toMatch(/^0\n/);
  });
});

describe('exportBook — EPUB', () => {
  const uid = 'jane-epub';
  let bookId: string;
  let response: ExportBookResponse;
  let epub: Buffer;

  beforeAll(async () => {
    bookId = await seedBook(uid);
    response = await callExport(uid, { bookId, format: 'epub', requestId: 'req-epub-1' });
    epub = Buffer.from(response.base64, 'base64');
  });

  it('responds with the file metadata', () => {
    expect(response).toMatchObject({
      exportId: 'req-epub-1',
      format: 'epub',
      fileName: 'il-mulino-di-rocca-bassa.epub',
      mimeType: 'application/epub+zip',
      createdAt: NOW,
    });
    expect(response.size).toBe(epub.length);
    expect(epub.length).toBeGreaterThan(1000);
  });

  it('records the export at users/{uid}/exports/{requestId} (without Storage)', async () => {
    const registry = await db.doc(`users/${uid}/exports/req-epub-1`).get();
    expect(registry.data()).toMatchObject({
      schemaVersion: 1,
      bookId,
      format: 'epub',
      storagePath: null,
      createdAt: NOW,
      fileName: 'il-mulino-di-rocca-bassa.epub',
      size: epub.length,
    });
  });

  it('ignores pending suggestions: exports only the rawText', async () => {
    const zip = await JSZip.loadAsync(epub);
    const contents = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => name.endsWith('.xhtml'))
        .map((name) => zip.file(name)?.async('string') as Promise<string>),
    );
    const allContent = contents.join('\n');
    expect(allContent).toContain('La corriera delle sette e un quarto');
    expect(allContent).not.toContain(PROPOSTA_PENDING);
  });

  it('passes EPUBCheck with no errors or warnings (same engine as KDP)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bookvoice-export-'));
    const file = join(dir, response.fileName);
    writeFileSync(file, epub);
    const result = runEpubcheck(file);
    expect(`${result.status}\n${result.output}`).toMatch(/^0\n/);
  });

  it('the package names the author as creator, publisher and rights holder, never "anonymous"', async () => {
    const zip = await JSZip.loadAsync(epub);
    const opfFile = Object.keys(zip.files).find((name) => name.endsWith('.opf'));
    const opf = (await zip.file(opfFile as string)?.async('string')) as string;
    expect(opf).toContain('<dc:creator id="creator">Jane Doe</dc:creator>');
    expect(opf).toContain('<dc:publisher>Jane Doe</dc:publisher>');
    expect(opf).toMatch(/<dc:rights>Copyright &#x00A9; \d{4} by Jane Doe<\/dc:rights>/);
    expect(opf).not.toContain('anonymous');
  });

  it('is idempotent: same requestId → same export, no duplicate registry entry', async () => {
    const retry = await callExport(uid, { bookId, format: 'epub', requestId: 'req-epub-1' });
    expect(retry.exportId).toBe('req-epub-1');
    expect(retry.createdAt).toBe(NOW);
    expect(retry.fileName).toBe(response.fileName);
    const registry = await db.collection(`users/${uid}/exports`).get();
    expect(registry.size).toBe(1);
  });

  it('rejects reuse of the requestId for a different export', async () => {
    await expectHttpsError(
      callExport(uid, { bookId, format: 'docx', requestId: 'req-epub-1' }),
      'already-exists',
    );
  });
});

describe('exportBook — DOCX', () => {
  const uid = 'jane-docx';

  it('generates a DOCX with an openable OOXML structure', async () => {
    const bookId = await seedBook(uid);
    const response = await callExport(uid, { bookId, format: 'docx', requestId: 'req-docx-1' });
    expect(response.fileName).toBe('il-mulino-di-rocca-bassa.docx');
    expect(response.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const zip = await JSZip.loadAsync(Buffer.from(response.base64, 'base64'));
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    const document = (await zip.file('word/document.xml')?.async('string')) as string;
    expect(document).toContain('Capitolo I — Il ritorno');
    expect(document).toContain('La corriera delle sette e un quarto');
    expect(document).not.toContain(PROPOSTA_PENDING);
  });
});

describe('exportBook — errors', () => {
  const uid = 'jane-errori';

  it('without authentication: unauthenticated', async () => {
    const handler = createExportBookHandler({ db });
    await expectHttpsError(
      handler(fakeRequest({ bookId: 'x', format: 'epub', requestId: 'r1' })),
      'unauthenticated',
    );
  });

  it('malformed input: invalid-argument', async () => {
    await expectHttpsError(
      callExport(uid, { bookId: 'x', format: 'pdf', requestId: 'r1' }),
      'invalid-argument',
    );
    await expectHttpsError(
      callExport(uid, { bookId: 'x', format: 'epub', requestId: 'niente spazi!' }),
      'invalid-argument',
    );
  });

  it('nonexistent book: not-found', async () => {
    await expectHttpsError(
      callExport(uid, { bookId: 'non-esiste', format: 'epub', requestId: 'r2' }),
      'not-found',
    );
  });

  it('book without chapters: failed-precondition (no orphaned registry entry)', async () => {
    const bookId = await seedBook(uid, { chapters: false });
    await expectHttpsError(
      runExportBook({ db }, uid, { bookId, format: 'epub', requestId: 'r3' }),
      'failed-precondition',
    );
    const registry = await db.collection(`users/${uid}/exports`).get();
    expect(registry.size).toBe(0);
  });
});
