// Integration test of the generateOutline callable against the
// Firestore emulator (NEVER real projects). The model is an injected fake
// (OutlineModel Strategy): real Gemini calls live in the optional smoke test
// geminiOutline.smoke.test.ts. The following is verified:
//  - happy path: validated outline and users/{uid}/outlines/{requestId} registry entry;
//  - context: chapters with text enter the prompt as "already written",
//    empty ones do not; the book style (or the one the app sends) shapes it;
//  - idempotency on requestId: retry → same response, ONE single model
//    call; same requestId on another book → already-exists;
//  - retry on non-conforming output (1 extra attempt, then 'unavailable');
//  - clear errors (auth, input, missing book).

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { createGenerateOutlineHandler } from '../ai/generateOutline';
import type { OutlinePrompt } from '../ai/outlinePrompt';
import { OUTLINE_PROMPT_VERSION } from '../ai/outlinePrompt';
import type { GenerateOutlineResponse, OutlineModel } from '../ai/types';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error('These tests run ONLY against the Firestore emulator (firebase emulators:exec).');
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-functions';
const NOW = 1757800000000;

const OUTLINE_FINTO = {
  chapters: [
    {
      title: 'La gola chiusa',
      summary: 'Viola scopre cosa vive nella gola sopra il mulino.',
      beats: ['La frana sul sentiero', 'Il favo nella cappella', 'Il ronzio sotto la ruota'],
    },
    {
      title: 'Il patto',
      summary: 'Olga confessa il patto della valle.',
      beats: ['Il retro del bar', 'Il quaderno delle quote', 'La lite in piazza'],
    },
  ],
};

/** Fake OutlineModel: records the prompts it receives and answers from a script. */
class FakeOutlineModel implements OutlineModel {
  readonly modelName = 'fake-pro';
  readonly prompts: OutlinePrompt[] = [];
  private readonly script: (unknown | Error)[];

  constructor(script: (unknown | Error)[] = [OUTLINE_FINTO]) {
    this.script = [...script];
  }

  async generate(prompt: OutlinePrompt): Promise<unknown> {
    this.prompts.push(prompt);
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next instanceof Error) throw next;
    return next;
  }
}

let db: Firestore;

/** Seeds a book with mixed chapters: two with text, one empty (slot for the merge). */
async function seedBook(uid: string, bookId = 'libro-di-prova'): Promise<string> {
  const bookRef = db.doc(`users/${uid}/books/${bookId}`);
  await bookRef.set({
    schemaVersion: 1,
    title: 'Il mulino di Rocca Bassa',
    author: 'Jane Doe',
    description: 'Sinossi e capitoli interamente fittizi.',
    synopsis: '',
    genre: 'romanzo',
    language: 'it',
    status: 'draft',
    styleProfileId: null,
    wordCount: 12,
    chapterCount: 3,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const chapters = bookRef.collection('chapters');
  await chapters.doc('cap-1').set({
    schemaVersion: 1,
    order: 0,
    title: 'Il ritorno',
    status: 'draft',
    wordCount: 8,
    rawText: 'La corriera arrivò in valle con mezz’ora di ritardo.',
    updatedAt: NOW,
  });
  await chapters.doc('cap-2').set({
    schemaVersion: 1,
    order: 1,
    title: 'Capitolo vuoto',
    status: 'draft',
    wordCount: 0,
    rawText: '',
    updatedAt: NOW,
  });
  await chapters.doc('cap-3').set({
    schemaVersion: 1,
    order: 2,
    title: 'Il registro',
    status: 'draft',
    wordCount: 4,
    rawText: 'Date, orari e coordinate.',
    updatedAt: NOW,
  });
  return bookId;
}

function callableRequest(uid: string | undefined, data: unknown): CallableRequest<unknown> {
  return { auth: uid === undefined ? undefined : { uid }, data } as CallableRequest<unknown>;
}

const SINOSSI = 'Viola rileva le arnie di un mulino e scopre un patto antico con la valle.';

function input(bookId: string, requestId: string) {
  return { bookId, synopsis: SINOSSI, requestId };
}

async function run(
  model: OutlineModel,
  uid: string | undefined,
  data: unknown,
): Promise<GenerateOutlineResponse> {
  const handler = createGenerateOutlineHandler({ db, model, now: () => NOW });
  return handler(callableRequest(uid, data));
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  db = getFirestore();
});

describe('generateOutline (Firestore emulator, fake model)', () => {
  it('happy path: outline validated, registry entry written, written chapters in the prompt', async () => {
    const uid = 'utente-outline-felice';
    const bookId = await seedBook(uid);
    const model = new FakeOutlineModel();

    const response = await run(model, uid, input(bookId, 'req-1'));

    expect(response.chapters).toEqual(OUTLINE_FINTO.chapters);
    expect(response.model).toBe('fake-pro');
    expect(response.promptVersion).toBe(OUTLINE_PROMPT_VERSION);
    expect(response.createdAt).toBe(NOW);

    // context: only chapters WITH text enter as "already written"
    expect(model.prompts).toHaveLength(1);
    expect(model.prompts[0]?.userText).toContain('1. Il ritorno');
    expect(model.prompts[0]?.userText).toContain('2. Il registro');
    expect(model.prompts[0]?.userText).not.toContain('Capitolo vuoto');
    expect(model.prompts[0]?.userText).toContain(SINOSSI);

    const registry = await db.doc(`users/${uid}/outlines/req-1`).get();
    expect(registry.exists).toBe(true);
    expect(registry.data()).toMatchObject({
      schemaVersion: 1,
      bookId,
      model: 'fake-pro',
      promptVersion: OUTLINE_PROMPT_VERSION,
      createdAt: NOW,
    });
  });

  it('the book style reaches the prompt; the style sent by the app wins over the saved one', async () => {
    const uid = 'utente-outline-stile';
    const bookId = await seedBook(uid);
    await db.doc(`users/${uid}/books/${bookId}`).update({ styleProfileId: 'mystery' });
    const model = new FakeOutlineModel();

    await run(model, uid, input(bookId, 'req-stile-1'));
    expect(model.prompts[0]?.userText).toContain('Stile del libro: Mystery (giallo)');

    await run(model, uid, { ...input(bookId, 'req-stile-2'), styleId: 'thriller' });
    expect(model.prompts[1]?.userText).toContain('Stile del libro: Thriller');
  });

  it('idempotency: retry with the same requestId → same response, ONE model call', async () => {
    const uid = 'utente-outline-idempotente';
    const bookId = await seedBook(uid);
    const model = new FakeOutlineModel();

    const prima = await run(model, uid, input(bookId, 'req-retry'));
    const seconda = await run(model, uid, input(bookId, 'req-retry'));

    expect(seconda).toEqual(prima);
    expect(model.prompts).toHaveLength(1);
  });

  it('same requestId on ANOTHER book → already-exists', async () => {
    const uid = 'utente-outline-conflitto';
    const bookId = await seedBook(uid);
    const altroLibro = await seedBook(uid, 'altro-libro');
    const model = new FakeOutlineModel();

    await run(model, uid, input(bookId, 'req-cond'));
    await expect(run(model, uid, input(altroLibro, 'req-cond'))).rejects.toMatchObject({
      code: 'already-exists',
    });
  });

  it('non-conforming output on the first try → retry succeeds (2 calls)', async () => {
    const uid = 'utente-outline-retry';
    const bookId = await seedBook(uid);
    const model = new FakeOutlineModel([{ chapters: 'spazzatura' }, OUTLINE_FINTO]);

    const response = await run(model, uid, input(bookId, 'req-2'));
    expect(response.chapters).toEqual(OUTLINE_FINTO.chapters);
    expect(model.prompts).toHaveLength(2);
  });

  it('non-conforming output on the retry too → unavailable and NO registry entry', async () => {
    const uid = 'utente-outline-kaputt';
    const bookId = await seedBook(uid);
    const model = new FakeOutlineModel([{ chapters: [] }]);

    await expect(run(model, uid, input(bookId, 'req-3'))).rejects.toMatchObject({
      code: 'unavailable',
    });
    expect(model.prompts).toHaveLength(2);
    const registry = await db.doc(`users/${uid}/outlines/req-3`).get();
    expect(registry.exists).toBe(false);
  });

  it('usage cap: blocks above the limit, the idempotent retry does not count', async () => {
    const uid = 'utente-outline-tetto';
    const bookId = await seedBook(uid);
    const handler = createGenerateOutlineHandler({
      db,
      model: new FakeOutlineModel(),
      now: () => NOW,
      usageLimits: {
        refineChapter: { perUserPerDay: 1, globalPerDay: 1000 },
        generateOutline: { perUserPerDay: 1, globalPerDay: 1000 },
      },
    });

    await handler(callableRequest(uid, input(bookId, 'req-tetto-1')));
    // idempotent retry: reuses the saved outline, does not consume the slot
    await handler(callableRequest(uid, input(bookId, 'req-tetto-1')));
    await expect(handler(callableRequest(uid, input(bookId, 'req-tetto-2')))).rejects.toMatchObject(
      { code: 'resource-exhausted' },
    );
  });

  it('without auth → unauthenticated', async () => {
    await expect(run(new FakeOutlineModel(), undefined, input('x', 'req-4'))).rejects.toMatchObject(
      { code: 'unauthenticated' },
    );
  });

  it('invalid input → invalid-argument', async () => {
    await expect(
      run(new FakeOutlineModel(), 'utente-x', { bookId: 'x', synopsis: '  ', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('nonexistent book → not-found', async () => {
    await expect(
      run(new FakeOutlineModel(), 'utente-senza-libri', input('non-esiste', 'req-5')),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
