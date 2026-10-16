// Il provider vero dietro l'interfaccia della schermata Editor: chiama la callable
// refineChapter e valida la risposta con Zod al confine. La `call` è iniettata
// (come nei test di CallableOutlineService): qui niente rete né Firebase.

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
  it('passa la richiesta alla callable e valida la risposta con Zod', async () => {
    const calls: RefineRequest[] = [];
    const provider = new CallableSuggestionsProvider({
      call: async (data) => {
        calls.push(data);
        return {
          data: {
            // campi extra del server (diagnostica): lo schema li scarta
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

  it('risposta non conforme → throw (mai suggerimenti non validati in UI)', async () => {
    const provider = new CallableSuggestionsProvider({
      call: async () => ({ data: { suggestions: 'non-un-array' } }),
    });
    await expect(provider.refine(REQUEST)).rejects.toThrow();
  });

  it('propaga gli errori della callable (la UI mostra refineFailed)', async () => {
    const provider = new CallableSuggestionsProvider({
      call: async () => {
        throw new Error('unavailable');
      },
    });
    await expect(provider.refine(REQUEST)).rejects.toThrow('unavailable');
  });
});
