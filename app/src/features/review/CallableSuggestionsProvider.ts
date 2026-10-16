// SuggestionsProvider sulla callable `refineChapter` (functions):
// l'unico punto dell'app che parla con le Cloud Functions per la rifinitura.
// Subentra al FakeSuggestionsProvider dietro la STESSA interfaccia (Strategy):
// la UI non cambia. La risposta passa da Zod al confine —
// refineResultSchema scarta i campi extra del server (model, discarded, …)
// e garantisce la gerarchia delle proposte.

import { httpsCallable, type Functions } from 'firebase/functions';

import {
  refineResultSchema,
  type RefineRequest,
  type RefineResult,
  type SuggestionsProvider,
} from './types';

type CallRefine = (data: RefineRequest) => Promise<{ data: unknown }>;

export type CallableSuggestionsProviderDeps =
  | { functions: Functions }
  /** Iniettabile nei test al posto di httpsCallable. */
  | { call: CallRefine };

export class CallableSuggestionsProvider implements SuggestionsProvider {
  private readonly call: CallRefine;

  constructor(deps: CallableSuggestionsProviderDeps) {
    this.call =
      'call' in deps
        ? deps.call
        : httpsCallable<RefineRequest, unknown>(deps.functions, 'refineChapter', {
            timeout: 300_000,
          });
  }

  async refine(request: RefineRequest): Promise<RefineResult> {
    const result = await this.call(request);
    return refineResultSchema.parse(result.data);
  }
}
