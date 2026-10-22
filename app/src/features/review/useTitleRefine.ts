// «Rifinisci il titolo» in the reading view: tap the title, ask the refineTitle
// callable for alternatives, pick one, save it on the chapter. Errors are values
// (TitleRefineResult): the panel shows the message, the title stays.

import { useCallback, useState } from 'react';

import type { ChapterPatch, ChapterRef } from '../chapters';
import { t } from '../../i18n';
import { makeRequestId } from '../../lib/requestId';
import { logTestEvent } from '../testLog';
import type { TitleRefineService } from './titles';

export type TitlePanelState = 'closed' | 'open' | 'loading' | 'proposals' | 'error';

export interface TitleRefineController {
  /** false without a service or a place to save: the title is plain text. */
  available: boolean;
  /** The chapter's own title (without the numeral). */
  name: string;
  state: TitlePanelState;
  proposals: readonly string[];
  message: string;
  toggle(): void;
  close(): void;
  request(): Promise<void>;
  choose(title: string): Promise<void>;
}

export function useTitleRefine(options: {
  chapter: ChapterRef;
  name: string;
  service?: TitleRefineService;
  repository?: { updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void> };
}): TitleRefineController {
  const { chapter, service, repository } = options;
  const [name, setName] = useState(options.name);
  const [state, setState] = useState<TitlePanelState>('closed');
  const [proposals, setProposals] = useState<readonly string[]>([]);
  const [message, setMessage] = useState('');
  const available = service !== undefined && repository !== undefined;

  const toggle = useCallback(() => {
    if (!available) return;
    setState((current) => (current === 'closed' ? 'open' : 'closed'));
    setMessage('');
  }, [available]);
  const close = useCallback(() => setState('closed'), []);

  const request = useCallback(async () => {
    if (service === undefined) return;
    setState('loading');
    setMessage('');
    const result = await service.suggestTitles({
      bookId: chapter.bookId,
      chapterId: chapter.chapterId,
      title: name,
      requestId: makeRequestId('tit'),
    });
    if (!result.ok) {
      setMessage(result.message);
      setState('error');
      return;
    }
    if (result.proposals.length === 0) {
      setMessage(t('review.title.none'));
      setState('error');
      return;
    }
    setProposals(result.proposals);
    setState('proposals');
  }, [chapter, name, service]);

  const choose = useCallback(
    async (title: string) => {
      if (repository === undefined) return;
      const previous = name;
      setName(title);
      setState('closed');
      try {
        await repository.updateChapter(chapter, { title });
      } catch {
        // structured, ids only: the dev test log and the console
        console.warn('title-save-failed', { chapterId: chapter.chapterId });
        logTestEvent('ui.error', { where: 'title-save', chapterId: chapter.chapterId });
        setName(previous);
        setMessage(t('review.title.saveFailed'));
        setState('error');
      }
    },
    [chapter, name, repository],
  );

  return { available, name, state, proposals, message, toggle, close, request, choose };
}
