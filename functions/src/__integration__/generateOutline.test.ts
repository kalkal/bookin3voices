// Test d'integrazione della callable generateOutline contro
// l'emulatore Firestore (MAI progetti reali). Il modello è un fake
// iniettato (Strategy OutlineModel): le chiamate vere a Gemini stanno nel
// fumo opzionale geminiOutline.smoke.test.ts. Si verificano:
//  - percorso felice: outline validato e registro users/{uid}/outlines/{requestId};
//  - contesto: i capitoli con testo entrano nel prompt come "già scritti",
//    quelli vuoti no;
//  - idempotenza sul requestId: retry → stessa risposta, UNA sola chiamata al
//    modello; stesso requestId su altro libro → already-exists;
//  - retry sull'output non conforme (1 tentativo in più, poi 'unavailable');
//  - errori chiari (auth, input, libro mancante).

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { createGenerateOutlineHandler } from '../ai/generateOutline';
import type { OutlinePrompt } from '../ai/outlinePrompt';
import { OUTLINE_PROMPT_VERSION } from '../ai/outlinePrompt';
import type { GenerateOutlineResponse, OutlineModel } from '../ai/types';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error(
    'Questi test girano SOLO contro l’emulatore Firestore (firebase emulators:exec).',
  );
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-functions';
const NOW = 1757800000000;

const OUTLINE_FINTO = {
  chapters: [
    {
      title: 'La secca',
      summary: 'Nora scopre cosa vive nella secca davanti al faro.',
      beats: ['La bassa marea', 'Le ossa di una chiglia', 'Il canto sott’acqua'],
    },
    {
      title: 'Il patto',
      summary: 'Tommaso confessa il patto dei pescatori.',
      beats: ['La cantina del bar', 'Il quaderno delle quote', 'La lite sul molo'],
    },
  ],
};

/** Fake OutlineModel: registra i prompt ricevuti e risponde a copione. */
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

/** Semina un libro con capitoli misti: due con testo, uno vuoto (slot per il merge). */
async function seedBook(uid: string, bookId = 'libro-di-prova'): Promise<string> {
  const bookRef = db.doc(`users/${uid}/books/${bookId}`);
  await bookRef.set({
    schemaVersion: 1,
    title: 'Il faro di Levante',
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
    rawText: 'Il traghetto attraccò con mezz’ora di ritardo.',
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

const SINOSSI = 'Nora eredita un faro dismesso e scopre un patto antico col mare.';

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

describe('generateOutline (emulatore Firestore, modello finto)', () => {
  it('percorso felice: outline validato, registro scritto, capitoli scritti nel prompt', async () => {
    const uid = 'utente-outline-felice';
    const bookId = await seedBook(uid);
    const model = new FakeOutlineModel();

    const response = await run(model, uid, input(bookId, 'req-1'));

    expect(response.chapters).toEqual(OUTLINE_FINTO.chapters);
    expect(response.model).toBe('fake-pro');
    expect(response.promptVersion).toBe(OUTLINE_PROMPT_VERSION);
    expect(response.createdAt).toBe(NOW);

    // contesto: solo i capitoli CON testo entrano come "già scritti"
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

  it('idempotenza: retry con lo stesso requestId → stessa risposta, UNA chiamata al modello', async () => {
    const uid = 'utente-outline-idempotente';
    const bookId = await seedBook(uid);
    const model = new FakeOutlineModel();

    const prima = await run(model, uid, input(bookId, 'req-retry'));
    const seconda = await run(model, uid, input(bookId, 'req-retry'));

    expect(seconda).toEqual(prima);
    expect(model.prompts).toHaveLength(1);
  });

  it('stesso requestId su un ALTRO libro → already-exists', async () => {
    const uid = 'utente-outline-conflitto';
    const bookId = await seedBook(uid);
    const altroLibro = await seedBook(uid, 'altro-libro');
    const model = new FakeOutlineModel();

    await run(model, uid, input(bookId, 'req-cond'));
    await expect(run(model, uid, input(altroLibro, 'req-cond'))).rejects.toMatchObject({
      code: 'already-exists',
    });
  });

  it('output non conforme al primo colpo → retry riuscito (2 chiamate)', async () => {
    const uid = 'utente-outline-retry';
    const bookId = await seedBook(uid);
    const model = new FakeOutlineModel([{ chapters: 'spazzatura' }, OUTLINE_FINTO]);

    const response = await run(model, uid, input(bookId, 'req-2'));
    expect(response.chapters).toEqual(OUTLINE_FINTO.chapters);
    expect(model.prompts).toHaveLength(2);
  });

  it('output non conforme anche al retry → unavailable e NESSUN registro', async () => {
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

  it('tetto d’uso: blocca oltre il limite, il retry idempotente non conta', async () => {
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
    // retry idempotente: riusa l'outline salvato, non consuma lo slot
    await handler(callableRequest(uid, input(bookId, 'req-tetto-1')));
    await expect(handler(callableRequest(uid, input(bookId, 'req-tetto-2')))).rejects.toMatchObject(
      { code: 'resource-exhausted' },
    );
  });

  it('senza auth → unauthenticated', async () => {
    await expect(run(new FakeOutlineModel(), undefined, input('x', 'req-4'))).rejects.toMatchObject(
      { code: 'unauthenticated' },
    );
  });

  it('input non valido → invalid-argument', async () => {
    await expect(
      run(new FakeOutlineModel(), 'utente-x', { bookId: 'x', synopsis: '  ', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('libro inesistente → not-found', async () => {
    await expect(
      run(new FakeOutlineModel(), 'utente-senza-libri', input('non-esiste', 'req-5')),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
