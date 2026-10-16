// Test d'integrazione della callable refineChapter contro
// l'emulatore Firestore (MAI progetti reali). Il modello è un fake
// iniettato (Strategy RefineModel); la chiamata vera sta nel fumo opzionale
// geminiRefine.smoke.test.ts. Si verificano:
//  - percorso felice: suggerimenti validati, ancorati, scritti in batch nella
//    sottocollezione `suggestions` + registro users/{uid}/refines/{requestId};
//  - contesto sinossi/outline: sinossi del libro e outline del capitolo entrano nel prompt;
//  - idempotenza requestId (retry → stessa risposta, UNA chiamata al modello;
//    riuso su altro capitolo → already-exists);
//  - dedup: i pending non decisi vengono sostituiti, accettati/rifiutati
//    restano;
//  - original non combaciante → scartato dal server;
//  - output non conforme due volte → 'unavailable' e NESSUNA scrittura
//    parziale (atomicità);
//  - riserva su 503 del primario;
//  - provider da settings/app (default gemini; sconosciuto → failed-precondition);
//  - errori chiari (auth, input, textHash non combaciante, capitolo mancante).

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { GeminiHttpError } from '../ai/GeminiRefineModel';
import { createRefineChapterHandler, type RefineChapterDeps } from '../ai/refineChapter';
import type { RefinePrompt } from '../ai/refinePrompt';
import type { RefineChapterResponse, RefineModel } from '../ai/refineTypes';
import { textHash } from '../ai/textHash';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error(
    'Questi test girano SOLO contro l’emulatore Firestore (firebase emulators:exec).',
  );
}

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-bookvoice-functions';
const NOW = 1757900000000;

const TESTO =
  'Elena posò lentamente la tazza sul tavolo e sentì che qualcosa non andava. uscì fuori in giardino.';

const OUTPUT_FINTO = {
  suggestions: [
    {
      original: 'posò lentamente',
      kind: 'style',
      rationale: 'L’avverbio annacqua il gesto.',
      proposals: ['posò', 'appoggiò'],
    },
    {
      original: 'sentì che qualcosa non andava',
      kind: 'style',
      rationale: 'Verbo filtro: percezione diretta.',
      proposals: ['qualcosa non andava'],
    },
    {
      original: 'uscì fuori in giardino.',
      kind: 'grammar',
      rationale: 'Maiuscola mancante dalla dettatura.',
      proposals: ['Uscì in giardino.'],
    },
  ],
};

/** Fake RefineModel: registra i prompt e risponde a copione. */
class FakeRefineModel implements RefineModel {
  readonly prompts: RefinePrompt[] = [];
  private readonly script: (unknown | Error)[];

  constructor(
    script: (unknown | Error)[] = [OUTPUT_FINTO],
    readonly modelName = 'fake-flash',
  ) {
    this.script = [...script];
  }

  async generate(prompt: RefinePrompt): Promise<unknown> {
    this.prompts.push(prompt);
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next instanceof Error) throw next;
    return next;
  }
}

/** Profilo di stile finto: i test non dipendono dai file veri in content/. */
const PROFILO_FINTO = {
  styleBible: 'Style Bible di prova: la voce è intoccabile.',
  fewShots: 'Esempio finto.',
};

let db: Firestore;
let uidCounter = 0;

function freshUid(): string {
  uidCounter += 1;
  return `utente-refine-${uidCounter}`;
}

async function seed(
  uid: string,
  withOutline = false,
): Promise<{ bookId: string; chapterId: string }> {
  const bookRef = db.doc(`users/${uid}/books/libro-di-prova`);
  await bookRef.set({
    schemaVersion: 1,
    title: 'Il faro di Levante',
    author: 'Jane Doe',
    description: 'Interamente fittizio.',
    synopsis: withOutline ? 'Nora eredita un faro dismesso e scopre un patto col mare.' : '',
    genre: 'romanzo',
    language: 'it',
    status: 'draft',
    styleProfileId: null,
    wordCount: 17,
    chapterCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await bookRef
    .collection('chapters')
    .doc('cap-1')
    .set({
      schemaVersion: 1,
      order: 0,
      title: 'Il ritorno',
      status: 'draft',
      wordCount: 17,
      rawText: TESTO,
      outline: withOutline
        ? {
            summary: 'La prima notte al faro.',
            beats: ['L’arrivo', 'Il registro strappato'],
            beatsDone: [],
          }
        : null,
      updatedAt: NOW,
    });
  return { bookId: 'libro-di-prova', chapterId: 'cap-1' };
}

function callableRequest(uid: string | undefined, data: unknown): CallableRequest<unknown> {
  return { auth: uid === undefined ? undefined : { uid }, data } as CallableRequest<unknown>;
}

function input(bookId: string, chapterId: string, requestId: string, text = TESTO) {
  return { bookId, chapterId, text, textHash: textHash(text), requestId };
}

function makeDeps(primary: RefineModel, fallback?: RefineModel): RefineChapterDeps {
  return {
    db,
    defaultProvider: 'gemini',
    providers: {
      gemini: { primary, ...(fallback === undefined ? {} : { fallback }) },
      bedrock: { primary },
    },
    loadStyleProfile: () => PROFILO_FINTO,
    now: () => NOW,
  };
}

async function run(
  deps: RefineChapterDeps,
  uid: string | undefined,
  data: unknown,
): Promise<RefineChapterResponse> {
  return createRefineChapterHandler(deps)(callableRequest(uid, data));
}

async function listSuggestions(
  uid: string,
  bookId: string,
  chapterId: string,
): Promise<Array<{ id: string } & Record<string, unknown>>> {
  const snap = await db
    .collection(`users/${uid}/books/${bookId}/chapters/${chapterId}/suggestions`)
    .get();
  return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  db = getFirestore();
});

describe('refineChapter (emulatore Firestore, modello finto)', () => {
  it('percorso felice: suggerimenti ancorati, batch su Firestore e registro', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const model = new FakeRefineModel();

    const response = await run(makeDeps(model), uid, input(bookId, chapterId, 'req-1'));

    expect(response.requestId).toBe('req-1');
    expect(response.model).toBe('fake-flash');
    expect(response.textHash).toBe(textHash(TESTO));
    expect(response.discarded).toBe(0);
    expect(response.suggestions).toHaveLength(3);
    const [first] = response.suggestions;
    expect(first?.span).toEqual({ from: 6, to: 21 });
    expect(TESTO.slice(first?.span.from, first?.span.to)).toBe('posò lentamente');
    expect(first?.state).toBe('pending');

    // scritti in batch nella sottocollezione, con metadati di provenienza
    const stored = await listSuggestions(uid, bookId, chapterId);
    expect(stored).toHaveLength(3);
    expect(stored.map((s) => s.id).sort()).toEqual(['req-1-1', 'req-1-2', 'req-1-3']);
    const storedFirst = stored.find((s) => s.id === 'req-1-1') as Record<string, unknown>;
    expect(storedFirst.requestId).toBe('req-1');
    expect(storedFirst.state).toBe('pending');
    expect(storedFirst.textHash).toBe(textHash(TESTO));

    // registro di idempotenza
    const registry = await db.doc(`users/${uid}/refines/req-1`).get();
    expect(registry.exists).toBe(true);
    expect(registry.get('chapterId')).toBe(chapterId);
  });

  it('contesto sinossi/outline: Style Bible nel prefisso, sinossi e outline nello user text', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid, true);
    const model = new FakeRefineModel();

    await run(makeDeps(model), uid, input(bookId, chapterId, 'req-ctx'));

    const prompt = model.prompts[0];
    expect(prompt?.systemInstruction).toContain('Style Bible di prova');
    expect(prompt?.systemInstruction).toContain('Esempio finto');
    expect(prompt?.userText).toContain('Nora eredita un faro dismesso');
    expect(prompt?.userText).toContain('1. L’arrivo');
    expect(prompt?.userText).toContain('Il registro strappato');
    expect(prompt?.userText).toContain(TESTO);
  });

  it('idempotenza: stesso requestId → stessa risposta, UNA chiamata al modello', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const model = new FakeRefineModel();
    const deps = makeDeps(model);

    const first = await run(deps, uid, input(bookId, chapterId, 'req-idem'));
    const second = await run(deps, uid, input(bookId, chapterId, 'req-idem'));

    expect(second).toEqual(first);
    expect(model.prompts).toHaveLength(1);
    expect(await listSuggestions(uid, bookId, chapterId)).toHaveLength(3);
  });

  it('stesso requestId su un altro capitolo → already-exists', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    await db.doc(`users/${uid}/books/${bookId}/chapters/cap-2`).set({
      schemaVersion: 1,
      order: 1,
      title: 'Altro',
      status: 'draft',
      wordCount: 3,
      rawText: 'Altro testo qui.',
      outline: null,
      updatedAt: NOW,
    });
    const deps = makeDeps(new FakeRefineModel());

    await run(deps, uid, input(bookId, chapterId, 'req-dup'));
    await expect(
      run(deps, uid, input(bookId, 'cap-2', 'req-dup', 'Altro testo qui.')),
    ).rejects.toMatchObject({ code: 'already-exists' });
  });

  it('dedup: una nuova rifinitura sostituisce i pending, non i decisi', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const suggestionsRef = db.collection(
      `users/${uid}/books/${bookId}/chapters/${chapterId}/suggestions`,
    );
    await suggestionsRef.doc('vecchio-pending').set({
      schemaVersion: 1,
      kind: 'style',
      span: { from: 0, to: 5 },
      original: 'Elena',
      proposals: ['Lei'],
      rationale: 'vecchio giro',
      state: 'pending',
      textHash: 'v1-vecchio',
      requestId: 'req-vecchio',
      createdAt: NOW - 1000,
    });
    await suggestionsRef.doc('vecchio-accettato').set({
      schemaVersion: 1,
      kind: 'style',
      span: { from: 0, to: 5 },
      original: 'Elena',
      proposals: ['Lei'],
      rationale: 'deciso',
      state: 'accepted',
      textHash: 'v1-vecchio',
      requestId: 'req-vecchio',
      createdAt: NOW - 1000,
    });

    await run(makeDeps(new FakeRefineModel()), uid, input(bookId, chapterId, 'req-nuovo'));

    const stored = await listSuggestions(uid, bookId, chapterId);
    const ids = stored.map((s) => s.id);
    expect(ids).not.toContain('vecchio-pending');
    expect(ids).toContain('vecchio-accettato');
    expect(stored.filter((s) => s.state === 'pending')).toHaveLength(3);
  });

  it('original non combaciante col testo → scartato dal server', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const model = new FakeRefineModel([
      {
        suggestions: [
          ...OUTPUT_FINTO.suggestions,
          {
            original: 'frase che non esiste nel capitolo',
            kind: 'style',
            rationale: 'inventata',
            proposals: ['x'],
          },
        ],
      },
    ]);

    const response = await run(makeDeps(model), uid, input(bookId, chapterId, 'req-scarto'));

    expect(response.suggestions).toHaveLength(3);
    expect(response.discarded).toBe(1);
  });

  it('output non conforme due volte → unavailable e NESSUNA scrittura parziale', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const model = new FakeRefineModel([{ garbage: true }, { garbage: true }]);

    await expect(
      run(makeDeps(model), uid, input(bookId, chapterId, 'req-rotto')),
    ).rejects.toMatchObject({ code: 'unavailable' });

    expect(await listSuggestions(uid, bookId, chapterId)).toHaveLength(0);
    expect((await db.doc(`users/${uid}/refines/req-rotto`).get()).exists).toBe(false);
  });

  it('retry: output non conforme al primo tentativo, valido al secondo', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const model = new FakeRefineModel([{ garbage: true }, OUTPUT_FINTO]);

    const response = await run(makeDeps(model), uid, input(bookId, chapterId, 'req-retry'));

    expect(response.suggestions).toHaveLength(3);
    expect(model.prompts).toHaveLength(2);
  });

  it('503 sul primario → risponde la riserva (fallback configurato)', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const primary = new FakeRefineModel(
      [new GeminiHttpError(503, 'high demand'), new GeminiHttpError(503, 'high demand')],
      'fake-primario',
    );
    const fallback = new FakeRefineModel([OUTPUT_FINTO], 'fake-riserva');

    const response = await run(
      makeDeps(primary, fallback),
      uid,
      input(bookId, chapterId, 'req-503'),
    );

    expect(response.model).toBe('fake-riserva');
    expect(primary.prompts).toHaveLength(2);
    expect(fallback.prompts).toHaveLength(1);
  });

  it('provider da settings/app: gemini esplicito ok, sconosciuto → failed-precondition', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    await db.doc(`users/${uid}/settings/app`).set({ aiProvider: 'gemini' });
    await run(makeDeps(new FakeRefineModel()), uid, input(bookId, chapterId, 'req-prov'));

    await db.doc(`users/${uid}/settings/app`).set({ aiProvider: 'skynet' });
    await expect(
      run(makeDeps(new FakeRefineModel()), uid, input(bookId, chapterId, 'req-prov-2')),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('textHash non combaciante → invalid-argument', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    await expect(
      run(makeDeps(new FakeRefineModel()), uid, {
        ...input(bookId, chapterId, 'req-hash'),
        textHash: 'v1-0000000000000000',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('tetto d’uso: blocca oltre il limite, il retry idempotente non conta', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const deps: RefineChapterDeps = {
      ...makeDeps(new FakeRefineModel()),
      usageLimits: {
        refineChapter: { perUserPerDay: 1, globalPerDay: 1000 },
        generateOutline: { perUserPerDay: 1, globalPerDay: 1000 },
      },
    };

    // prima rifinitura reale: consuma l'unico slot del giorno
    await run(deps, uid, input(bookId, chapterId, 'req-lim-1'));
    // retry di rete sullo stesso requestId: short-circuit idempotente, NON conta
    await run(deps, uid, input(bookId, chapterId, 'req-lim-1'));
    // una nuova richiesta oltre il tetto viene respinta prima di toccare il modello
    await expect(run(deps, uid, input(bookId, chapterId, 'req-lim-2'))).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('errori chiari: senza auth, input malformato, capitolo mancante', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const deps = makeDeps(new FakeRefineModel());

    await expect(run(deps, undefined, input(bookId, chapterId, 'req-x'))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(run(deps, uid, { bookId })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(run(deps, uid, input(bookId, 'cap-fantasma', 'req-y'))).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});
