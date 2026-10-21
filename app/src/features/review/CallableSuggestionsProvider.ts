// SuggestionsProvider on the `refineChapter` callable (functions):
// the only place in the app that talks to the Cloud Functions for refinement.
// It takes over from FakeSuggestionsProvider behind the SAME interface (Strategy),
// so the UI does not change. The response goes through Zod at the boundary:
// refineResultSchema drops the server's extra fields (model, discarded, ...)
// and guarantees the proposal hierarchy.

import { httpsCallable, type Functions } from 'firebase/functions';
import { z } from 'zod';

import { callableErrorCode } from '../../lib/callableErrors';
import { isTestLogActive, logTestEvent } from '../testLog';
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

/** Server diagnostics kept only for the dev test log. */
const diagnosticsSchema = z.object({
  model: z.string().optional(),
  promptVersion: z.number().optional(),
  discarded: z.number().optional(),
  debugTrace: z.unknown().optional(),
});

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
    // dev builds with the test log ask the server for its debug trace
    const logging = isTestLogActive();
    const { bookId, chapterId, requestId, text } = request;
    const startedAt = Date.now();
    if (logging) {
      logTestEvent('refine.request', {
        bookId,
        chapterId,
        requestId,
        words: text.match(/\S+/g)?.length ?? 0,
        chars: text.length,
      });
    }
    let result: { data: unknown };
    try {
      result = await this.call(logging ? { ...request, debug: true } : request);
    } catch (error) {
      logTestEvent('refine.error', {
        requestId,
        code: callableErrorCode(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
    const parsed = refineResultSchema.parse(result.data);
    const served = servedModelSchema.safeParse(result.data);
    if (served.success) this.onServedModel?.(served.data.model);
    if (logging) {
      const diagnostics = diagnosticsSchema.safeParse(result.data);
      logTestEvent('refine.result', {
        requestId,
        chapterId,
        durationMs: Date.now() - startedAt,
        ...(diagnostics.success ? diagnostics.data : {}),
        suggestions: parsed.suggestions.map((s) => ({
          id: s.id,
          kind: s.kind,
          ...(s.aspect !== undefined ? { aspect: s.aspect } : {}),
          original: s.original,
          proposals: s.proposals,
          rationale: s.rationale,
        })),
      });
    }
    return parsed;
  }
}
