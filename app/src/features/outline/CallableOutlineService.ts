// OutlineService on the `generateOutline` callable (functions): the only point
// of the app that talks to the Cloud Functions for the outline. The response goes
// through Zod at the boundary: never trust data coming from outside.

import { httpsCallable, type Functions } from 'firebase/functions';

import {
  outlineProposalSchema,
  type GenerateOutlineRequest,
  type OutlineProposal,
  type OutlineService,
} from './types';

type CallGenerate = (data: GenerateOutlineRequest) => Promise<{ data: unknown }>;

export type CallableOutlineServiceDeps =
  | { functions: Functions }
  /** Injectable in tests in place of httpsCallable. */
  | { call: CallGenerate };

export class CallableOutlineService implements OutlineService {
  private readonly call: CallGenerate;

  constructor(deps: CallableOutlineServiceDeps) {
    this.call =
      'call' in deps
        ? deps.call
        : httpsCallable<GenerateOutlineRequest, unknown>(deps.functions, 'generateOutline', {
            timeout: 300_000,
          });
  }

  async generateOutline(request: GenerateOutlineRequest): Promise<OutlineProposal> {
    const result = await this.call(request);
    return outlineProposalSchema.parse(result.data);
  }
}
