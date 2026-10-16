// SuggestionsProvider on the `refineChapter` callable (functions):
// the only place in the app that talks to the Cloud Functions for refinement.
// It takes over from FakeSuggestionsProvider behind the SAME interface (Strategy),
// so the UI does not change. The response goes through Zod at the boundary:
// refineResultSchema drops the server's extra fields (model, discarded, ...)
// and guarantees the proposal hierarchy.

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
  /** Injectable in tests in place of httpsCallable. */
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
