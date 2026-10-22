// Integration test of the refineChapter callable against the
// Firestore emulator (NEVER real projects). The model is an injected fake
// (RefineModel Strategy); the real call lives in the optional smoke test
// geminiRefine.smoke.test.ts. The following is verified:
//  - happy path: suggestions validated, anchored, batch-written to the
//    `suggestions` subcollection + users/{uid}/refines/{requestId} registry entry;
//  - synopsis/outline context: the book synopsis and chapter outline enter the prompt;
//  - requestId idempotency (retry → same response, ONE model call;
//    reuse on another chapter → already-exists);
//  - dedup: undecided pending suggestions are replaced, accepted/rejected
//    ones remain;
//  - non-matching original → discarded by the server;
//  - non-conforming output twice → 'unavailable' and NO partial
//    write (atomicity);
//  - fallback on a 503 from the primary;
//  - provider from settings/app (default gemini; unknown → failed-precondition);
//  - clear errors (auth, input, non-matching textHash, missing chapter).

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { GeminiHttpError } from '../ai/GeminiRefineModel';
import { logger } from 'firebase-functions';

import type { AiProvider, AiResult } from '../ai/provider/types';
import { createRefineChapterHandler, type RefineChapterDeps } from '../ai/refineChapter';
import type { RefinePrompt } from '../ai/refinePrompt';
import type { RefineChapterResponse, RefineModel } from '../ai/refineTypes';
import { textHash } from '../ai/textHash';

if (process.env.FIRESTORE_EMULATOR_HOST === undefined) {
  throw new Error('These tests run ONLY against the Firestore emulator (firebase emulators:exec).');
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

/** Fake RefineModel: records the prompts and answers from a script. */
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

/** Fake style profile: the tests do not depend on the real files in content/. */
const PROFILO_FINTO = {
  styleBible: 'Test Style Bible: the voice is untouchable.',
  fewShots: 'Fake example.',
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
    title: 'Il mulino di Rocca Bassa',
    author: 'Jane Doe',
    description: 'Interamente fittizio.',
    synopsis: withOutline
      ? 'Viola rileva le arnie di un mulino e scopre un patto con la valle.'
      : '',
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
            summary: 'La prima notte al mulino.',
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

describe('refineChapter (Firestore emulator, fake model)', () => {
  it('happy path: anchored suggestions, Firestore batch and registry entry', async () => {
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

    // batch-written to the subcollection, with provenance metadata
    const stored = await listSuggestions(uid, bookId, chapterId);
    expect(stored).toHaveLength(3);
    expect(stored.map((s) => s.id).sort()).toEqual(['req-1-1', 'req-1-2', 'req-1-3']);
    const storedFirst = stored.find((s) => s.id === 'req-1-1') as Record<string, unknown>;
    expect(storedFirst.requestId).toBe('req-1');
    expect(storedFirst.state).toBe('pending');
    expect(storedFirst.textHash).toBe(textHash(TESTO));

    // idempotency registry
    const registry = await db.doc(`users/${uid}/refines/req-1`).get();
    expect(registry.exists).toBe(true);
    expect(registry.get('chapterId')).toBe(chapterId);
  });

  it('synopsis/outline context: Style Bible in the prefix, synopsis and outline in the user text', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid, true);
    const model = new FakeRefineModel();

    await run(makeDeps(model), uid, input(bookId, chapterId, 'req-ctx'));

    const prompt = model.prompts[0];
    expect(prompt?.systemInstruction).toContain('Test Style Bible');
    expect(prompt?.systemInstruction).toContain('Fake example');
    expect(prompt?.userText).toContain('Viola rileva le arnie di un mulino');
    expect(prompt?.userText).toContain('1. L’arrivo');
    expect(prompt?.userText).toContain('Il registro strappato');
    expect(prompt?.userText).toContain(TESTO);
  });

  it('idempotency: same requestId → same response, ONE model call', async () => {
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

  it('same requestId on another chapter → already-exists', async () => {
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

  it('dedup: a new refine replaces the pending suggestions, not the decided ones', async () => {
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
      rationale: 'previous run',
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
      rationale: 'decided',
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

  it('original not matching the text → discarded by the server', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const model = new FakeRefineModel([
      {
        suggestions: [
          ...OUTPUT_FINTO.suggestions,
          {
            original: 'frase che non esiste nel capitolo',
            kind: 'style',
            rationale: 'made up',
            proposals: ['x'],
          },
        ],
      },
    ]);

    const response = await run(makeDeps(model), uid, input(bookId, chapterId, 'req-scarto'));

    expect(response.suggestions).toHaveLength(3);
    expect(response.discarded).toBe(1);
  });

  it('non-conforming output twice → unavailable and NO partial write', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const model = new FakeRefineModel([{ garbage: true }, { garbage: true }]);

    await expect(
      run(makeDeps(model), uid, input(bookId, chapterId, 'req-rotto')),
    ).rejects.toMatchObject({ code: 'unavailable' });

    expect(await listSuggestions(uid, bookId, chapterId)).toHaveLength(0);
    expect((await db.doc(`users/${uid}/refines/req-rotto`).get()).exists).toBe(false);
  });

  it('retry: non-conforming output on the first attempt, valid on the second', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const model = new FakeRefineModel([{ garbage: true }, OUTPUT_FINTO]);

    const response = await run(makeDeps(model), uid, input(bookId, chapterId, 'req-retry'));

    expect(response.suggestions).toHaveLength(3);
    expect(model.prompts).toHaveLength(2);
  });

  it('503 on the primary → the fallback answers (fallback configured)', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const primary = new FakeRefineModel(
      [new GeminiHttpError(503, 'high demand'), new GeminiHttpError(503, 'high demand')],
      'fake-primary',
    );
    const fallback = new FakeRefineModel([OUTPUT_FINTO], 'fake-fallback');

    const response = await run(
      makeDeps(primary, fallback),
      uid,
      input(bookId, chapterId, 'req-503'),
    );

    expect(response.model).toBe('fake-fallback');
    expect(primary.prompts).toHaveLength(2);
    expect(fallback.prompts).toHaveLength(1);
  });

  it('provider from settings/app: explicit gemini ok, unknown → failed-precondition', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    await db.doc(`users/${uid}/settings/app`).set({ aiProvider: 'gemini' });
    await run(makeDeps(new FakeRefineModel()), uid, input(bookId, chapterId, 'req-prov'));

    await db.doc(`users/${uid}/settings/app`).set({ aiProvider: 'skynet' });
    await expect(
      run(makeDeps(new FakeRefineModel()), uid, input(bookId, chapterId, 'req-prov-2')),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('non-matching textHash → invalid-argument', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    await expect(
      run(makeDeps(new FakeRefineModel()), uid, {
        ...input(bookId, chapterId, 'req-hash'),
        textHash: 'v1-0000000000000000',
      }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('usage cap: blocks above the limit, the idempotent retry does not count', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const deps: RefineChapterDeps = {
      ...makeDeps(new FakeRefineModel()),
      usageLimits: {
        refineChapter: { perUserPerDay: 1, globalPerDay: 1000 },
        generateOutline: { perUserPerDay: 1, globalPerDay: 1000 },
        refineTitle: { perUserPerDay: 1, globalPerDay: 1000 },
      },
    };

    // first real refine: consumes the only slot of the day
    await run(deps, uid, input(bookId, chapterId, 'req-lim-1'));
    // network retry on the same requestId: idempotent short-circuit, does NOT count
    await run(deps, uid, input(bookId, chapterId, 'req-lim-1'));
    // a new request over the cap is rejected before touching the model
    await expect(run(deps, uid, input(bookId, chapterId, 'req-lim-2'))).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
  });

  it('debug trace: only when the deployment allows it AND the app asks; never stored', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid, true);
    const asked = { ...input(bookId, chapterId, 'req-dbg-1'), debug: true };

    const off = await run(makeDeps(new FakeRefineModel()), uid, asked);
    expect(off.debugTrace).toBeUndefined();

    const enabled = { ...makeDeps(new FakeRefineModel()), debugTrace: true };
    const notAsked = await run(enabled, uid, input(bookId, chapterId, 'req-dbg-2'));
    expect(notAsked.debugTrace).toBeUndefined();

    const traced = await run(enabled, uid, { ...asked, requestId: 'req-dbg-3' });
    expect(traced.debugTrace?.promptVersion).toBe(traced.promptVersion);
    expect(traced.debugTrace?.model).toBe('fake-flash');
    expect(traced.debugTrace?.context).toMatchObject({
      style: 'suspense',
      language: 'it',
      genre: 'romanzo',
      outlineBeats: 2,
      textChars: TESTO.length,
      textHash: textHash(TESTO),
    });
    expect(traced.debugTrace?.raw).toHaveLength(3);
    expect(traced.debugTrace?.normalized).toHaveLength(3);
    expect(traced.debugTrace?.dropped).toEqual([]);

    // the registry keeps no trace: an idempotent retry answers without it
    const registry = await db.doc(`users/${uid}/refines/req-dbg-3`).get();
    expect(registry.get('debugTrace')).toBeUndefined();
    const retry = await run(enabled, uid, { ...asked, requestId: 'req-dbg-3' });
    expect(retry.debugTrace).toBeUndefined();
  });

  it('clear errors: no auth, malformed input, missing chapter', async () => {
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

describe('refineChapter with the history check (Firestore emulator, fake models)', () => {
  const TESTO_STORICO =
    'Napoli, 1943. In cucina la madre aveva lasciato la lavatrice accesa. Elena uscì in strada.';
  const MAIN_STORICO = {
    suggestions: [
      {
        original: 'Elena uscì in strada.',
        kind: 'style',
        rationale: 'Ritmo.',
        proposals: ['Elena uscì.'],
      },
    ],
  };

  function historyProvider(results: AiResult[]): AiProvider {
    let calls = 0;
    return {
      name: 'gemini',
      modelName: 'fake-history',
      generateJson: async () => results[Math.min(calls++, results.length - 1)] as AiResult,
    };
  }

  function depsWithHistory(provider: AiProvider): RefineChapterDeps {
    const deps = makeDeps(new FakeRefineModel([MAIN_STORICO]));
    return { ...deps, history: { gemini: () => provider, bedrock: () => provider } };
  }

  afterEach(() => jest.restoreAllMocks());

  it('stores the history suggestions with their aspect next to the refinement', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const provider = historyProvider([
      {
        ok: true,
        value: { period_named: true, quote: 'Napoli, 1943', period_label: 'Naples, 1943' },
      },
      {
        ok: true,
        value: {
          anachronisms: [
            {
              trigger_quote: 'lavatrice',
              category: 'technology',
              severity: 'unlikely',
              replacement: 'tinozza',
              note_for_author: 'Nel 1943 era probabilmente rarissima.',
            },
          ],
          period_details: [],
        },
      },
    ]);

    const response = await run(
      depsWithHistory(provider),
      uid,
      input(bookId, chapterId, 'req-history-1', TESTO_STORICO),
    );

    const history = response.suggestions.find((s) => s.kind === 'history');
    expect(history).toMatchObject({
      aspect: 'anachronism',
      original: 'lavatrice',
      rationale: 'Da verificare: Nel 1943 era probabilmente rarissima.',
    });
    expect(response.suggestions.some((s) => s.kind === 'style')).toBe(true);
    const stored = await listSuggestions(uid, bookId, chapterId);
    expect(stored.find((s) => s.kind === 'history')).toMatchObject({ aspect: 'anachronism' });
  });

  it('kinds: only «period» → no main model call; no «period» → no history check', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const main = new FakeRefineModel([MAIN_STORICO]);
    let historyCalls = 0;
    const counting: AiProvider = {
      name: 'gemini',
      modelName: 'fake-history',
      generateJson: async () => {
        historyCalls += 1;
        return { ok: true, value: { period_named: false, quote: '', period_label: '' } };
      },
    };
    const deps = {
      ...makeDeps(main),
      history: { gemini: () => counting, bedrock: () => counting },
    };

    await run(deps, uid, {
      ...input(bookId, chapterId, 'req-kinds-1', TESTO_STORICO),
      kinds: ['history'],
    });
    expect(main.prompts).toHaveLength(0);
    expect(historyCalls).toBeGreaterThan(0);

    historyCalls = 0;
    const response = await run(deps, uid, {
      ...input(bookId, chapterId, 'req-kinds-2', TESTO_STORICO),
      kinds: ['style'],
    });
    expect(historyCalls).toBe(0);
    expect(main.prompts).toHaveLength(1);
    expect(response.suggestions.every((s) => s.kind === 'style')).toBe(true);
  });

  it('kinds: undecided suggestions of a kind turned off are kept', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const hash = textHash(TESTO_STORICO);
    const suggestionsRef = db.collection(
      `users/${uid}/books/${bookId}/chapters/${chapterId}/suggestions`,
    );
    await suggestionsRef.doc('pacing-pending').set({
      schemaVersion: 1,
      kind: 'pacing',
      span: { from: 0, to: 5 },
      original: 'Elena',
      proposals: ['Lei'],
      rationale: 'previous run',
      state: 'pending',
      textHash: hash,
      requestId: 'req-prima',
      createdAt: NOW - 1000,
    });
    await run(makeDeps(new FakeRefineModel([MAIN_STORICO])), uid, {
      ...input(bookId, chapterId, 'req-kinds-3', TESTO_STORICO),
      kinds: ['style'],
    });
    const ids = (await listSuggestions(uid, bookId, chapterId)).map((s) => s.id);
    expect(ids).toContain('pacing-pending');
  });

  it('degraded mode: a failing history check leaves the refinement intact and logs a warning', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const provider = historyProvider([
      { ok: false, error: { kind: 'throttled', retryable: true, message: 'slow down' } },
    ]);

    const response = await run(
      depsWithHistory(provider),
      uid,
      input(bookId, chapterId, 'req-history-2', TESTO_STORICO),
    );

    expect(response.suggestions.map((s) => s.kind)).toEqual(['style']);
    expect(warn).toHaveBeenCalledWith(
      'refineChapter: history check failed, refinement without history',
      expect.objectContaining({ requestId: 'req-history-2', kind: 'throttled' }),
    );
  });
});

describe('refineChapter density log (Firestore emulator, fake model)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('logs the density cut with requestId and counts, never the text', async () => {
    const uid = freshUid();
    const { bookId, chapterId } = await seed(uid);
    const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    const five = {
      suggestions: ['Elena', 'la tazza', 'sul tavolo', 'qualcosa non andava', 'in giardino'].map(
        (original) => ({ original, kind: 'style', rationale: 'r', proposals: ['x'] }),
      ),
    };

    const response = await run(
      makeDeps(new FakeRefineModel([five])),
      uid,
      input(bookId, chapterId, 'req-density'),
    );

    expect(response.suggestions).toHaveLength(3); // 17 words → cap 3
    expect(info).toHaveBeenCalledWith('refineChapter: density cap applied', {
      requestId: 'req-density',
      raw: 5,
      kept: 3,
      cut: 2,
    });
  });
});
