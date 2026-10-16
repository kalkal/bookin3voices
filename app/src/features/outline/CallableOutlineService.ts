// OutlineService sulla callable `generateOutline` (functions): l'unico punto
// dell'app che parla con le Cloud Functions per la scaletta. La risposta passa
// da Zod al confine: mai fidarsi dei dati che arrivano da fuori.

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
  /** Iniettabile nei test al posto di httpsCallable. */
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
