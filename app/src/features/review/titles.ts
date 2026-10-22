// «Rifinisci il titolo»: the chapter title is not part of the text, so it has
// its own small callable (refineTitle). Errors come back as values: the editor
// shows the message, nothing throws through the UI.

import { httpsCallable, type Functions } from 'firebase/functions';
import { z } from 'zod';

import { callableErrorMessage, logCallableFailure } from '../../lib/callableErrors';

export interface TitleRefineRequest {
  bookId: string;
  chapterId: string;
  /** The current title (may be empty). */
  title: string;
  requestId: string;
}

export type TitleRefineResult = { ok: true; proposals: string[] } | { ok: false; message: string };

export interface TitleRefineService {
  suggestTitles(request: TitleRefineRequest): Promise<TitleRefineResult>;
}

const responseSchema = z.object({ proposals: z.array(z.string().min(1)).max(3) });

type CallTitle = (data: TitleRefineRequest) => Promise<{ data: unknown }>;

export class CallableTitleRefineService implements TitleRefineService {
  private readonly call: CallTitle;

  constructor(deps: { functions: Functions } | { call: CallTitle }) {
    this.call =
      'call' in deps
        ? deps.call
        : httpsCallable<TitleRefineRequest, unknown>(deps.functions, 'refineTitle', {
            timeout: 120_000,
          });
  }

  async suggestTitles(request: TitleRefineRequest): Promise<TitleRefineResult> {
    try {
      const result = await this.call(request);
      return { ok: true, proposals: responseSchema.parse(result.data).proposals };
    } catch (error) {
      logCallableFailure('title', request.requestId, error);
      return { ok: false, message: callableErrorMessage('title', error) };
    }
  }
}

/** Dev/E2E: fixed proposals, no network. */
export class FakeTitleRefineService implements TitleRefineService {
  async suggestTitles(request: TitleRefineRequest): Promise<TitleRefineResult> {
    const base = request.title.trim() === '' ? 'Capitolo' : request.title.trim();
    return { ok: true, proposals: [`${base}, di notte`, `Prima di ${base.toLowerCase()}`] };
  }
}
