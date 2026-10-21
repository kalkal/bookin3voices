// SuggestionsProvider on the `refineChapter` callable (functions):
// the only place in the app that talks to the Cloud Functions for refinement.
// It takes over from FakeSuggestionsProvider behind the SAME interface (Strategy),
// so the UI does not change. The response goes through Zod at the boundary:
// refineResultSchema drops the server's extra fields (model, discarded, ...)
// and guarantees the proposal hierarchy.

import { httpsCallable, type Functions } from 'firebase/functions';
import { z } from 'zod';

import {
  refineResultSchema,
  type RefineRequest,
  type RefineResult,
  type SuggestionsProvider,
} from './types';

type CallRefine = (data: RefineRequest) => Promise<{ data: unknown }>;

export type CallableSuggestionsProviderDeps = (
  | { functions: Functions }
  /** Injectable in tests in place of httpsCallable. */
  | { call: CallRefine }
) & {
  /** The model the server says it used (shown in Settings, never guessed). */
  onServedModel?: (model: string) => void;
};

const servedModelSchema = z.object({ model: z.string().min(1) });

export class CallableSuggestionsProvider implements SuggestionsProvider {
  private readonly call: CallRefine;
  private readonly onServedModel?: (model: string) => void;

  constructor(deps: CallableSuggestionsProviderDeps) {
    this.onServedModel = deps.onServedModel;
    this.call =
      'call' in deps
        ? deps.call
        : httpsCallable<RefineRequest, unknown>(deps.functions, 'refineChapter', {
            timeout: 300_000,
          });
  }

  async refine(request: RefineRequest): Promise<RefineResult> {
    const result = await this.call(request);
    const parsed = refineResultSchema.parse(result.data);
    const served = servedModelSchema.safeParse(result.data);
    if (served.success) this.onServedModel?.(served.data.model);
    return parsed;
  }
}
