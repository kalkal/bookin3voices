// The real provider behind the Editor screen's interface: calls the refineChapter
// callable and validates the response with Zod at the boundary. `call` is injected
// (as in the CallableOutlineService tests): no network or Firebase here.

import { captureTestLog } from '../../../testing/testLog';
import { uninstallTestLog } from '../../testLog';
import { CallableSuggestionsProvider } from '../CallableSuggestionsProvider';
import { textHash } from '../textHash';
import type { RefineRequest } from '../types';

const TEXT = 'Elena posò lentamente la tazza.';

const REQUEST: RefineRequest = {
  bookId: 'libro-1',
  chapterId: 'cap-1',
  text: TEXT,
  textHash: textHash(TEXT),
  requestId: 'ref-1',
};

const SERVER_SUGGESTION = {
  id: 'ref-1-1',
  kind: 'style',
  span: { from: 6, to: 21 },
  original: 'posò lentamente',
  proposals: ['posò', 'appoggiò'],
  rationale: 'L’avverbio annacqua il gesto.',
  state: 'pending',
  textHash: textHash(TEXT),
};

describe('CallableSuggestionsProvider', () => {
  it('passes the request to the callable and validates the response with Zod', async () => {
    const calls: RefineRequest[] = [];
    const provider = new CallableSuggestionsProvider({
      call: async (data) => {
        calls.push(data);
        return {
          data: {
            // extra server fields (diagnostics): the schema drops them
            requestId: 'ref-1',
            model: 'gemini-3.5-flash',
            promptVersion: 1,
            discarded: 0,
            textHash: textHash(TEXT),
            suggestions: [SERVER_SUGGESTION],
          },
        };
      },
    });

    const result = await provider.refine(REQUEST);

    expect(calls).toEqual([REQUEST]);
    expect(result.textHash).toBe(textHash(TEXT));
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      id: 'ref-1-1',
      kind: 'style',
      state: 'pending',
    });
    expect(result).not.toHaveProperty('model');
  });

  it('reports the model the server really used (for Settings), outside the result', async () => {
    const served: string[] = [];
    const provider = new CallableSuggestionsProvider({
      call: async () => ({
        data: {
          requestId: 'ref-1',
          model: 'amazon.nova-pro-v1:0',
          textHash: textHash(TEXT),
          suggestions: [SERVER_SUGGESTION],
        },
      }),
      onServedModel: (model) => served.push(model),
    });
    await provider.refine(REQUEST);
    expect(served).toEqual(['amazon.nova-pro-v1:0']);
  });

  it('non-conforming response → throw (never unvalidated suggestions in the UI)', async () => {
    const provider = new CallableSuggestionsProvider({
      call: async () => ({ data: { suggestions: 'non-un-array' } }),
    });
    await expect(provider.refine(REQUEST)).rejects.toThrow();
  });

  it('propagates the callable errors (the UI shows refineFailed)', async () => {
    const provider = new CallableSuggestionsProvider({
      call: async () => {
        throw new Error('unavailable');
      },
    });
    await expect(provider.refine(REQUEST)).rejects.toThrow('unavailable');
  });
});

describe('CallableSuggestionsProvider and the dev test log', () => {
  afterEach(() => uninstallTestLog());

  const answer = (debugTrace?: unknown) => ({
    data: {
      requestId: 'ref-1',
      model: 'amazon.nova-pro-v1:0',
      promptVersion: 3,
      discarded: 1,
      textHash: textHash(TEXT),
      suggestions: [SERVER_SUGGESTION],
      ...(debugTrace === undefined ? {} : { debugTrace }),
    },
  });

  it('without a log: no debug flag sent, nothing recorded', async () => {
    const calls: unknown[] = [];
    const provider = new CallableSuggestionsProvider({
      call: async (data) => {
        calls.push(data);
        return answer();
      },
    });
    await provider.refine(REQUEST);
    expect(calls).toEqual([REQUEST]);
  });

  it('with a log: asks for the debug trace and records request, result and trace', async () => {
    const log = captureTestLog();
    const calls: unknown[] = [];
    const trace = { promptVersion: 3, model: 'amazon.nova-pro-v1:0', dropped: [] };
    const provider = new CallableSuggestionsProvider({
      call: async (data) => {
        calls.push(data);
        return answer(trace);
      },
    });

    await provider.refine(REQUEST);

    expect(calls).toEqual([{ ...REQUEST, debug: true }]);
    expect(log.events('refine.request')[0]).toMatchObject({
      bookId: 'libro-1',
      chapterId: 'cap-1',
      requestId: 'ref-1',
      words: 5,
    });
    const result = log.events('refine.result')[0];
    expect(result).toMatchObject({
      requestId: 'ref-1',
      model: 'amazon.nova-pro-v1:0',
      promptVersion: 3,
      discarded: 1,
      debugTrace: trace,
    });
    expect(result?.suggestions).toEqual([
      {
        id: 'ref-1-1',
        kind: 'style',
        original: 'posò lentamente',
        proposals: ['posò', 'appoggiò'],
        rationale: 'L’avverbio annacqua il gesto.',
      },
    ]);
    expect(typeof result?.durationMs).toBe('number');
  });

  it('with a log: records a failed call with its code', async () => {
    const log = captureTestLog();
    const provider = new CallableSuggestionsProvider({
      call: async () => {
        throw Object.assign(new Error('boom'), { code: 'functions/unavailable' });
      },
    });
    await expect(provider.refine(REQUEST)).rejects.toThrow('boom');
    expect(log.events('refine.error')[0]).toMatchObject({
      requestId: 'ref-1',
      code: 'unavailable',
    });
  });
});
