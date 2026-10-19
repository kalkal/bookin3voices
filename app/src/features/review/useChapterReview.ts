// Controller shared by the Chapter editor and Review: holds
// the ReviewSession (pure domain), text persistence (ChapterRepository,
// offline-first: every accepted patch is on disk immediately) and the history
// on `revisions` (RevisionRepository). The screens receive only this
// controller: never the SDK or the session directly.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ChapterRef, ChapterTextRepository } from '../chapters';
import { makeRequestId } from '../../lib/requestId';
import { DebouncedSaver } from '../dictation/autosave';
import { ReviewSession } from './ReviewSession';
import type { RevisionRepository } from './revisions';
import { textHash } from './textHash';
import { refineResultSchema } from './types';
import type { Suggestion, SuggestionKind, SuggestionsProvider } from './types';

export type ReviewLoadState = 'loading' | 'ready' | 'load-error';
export type ReviewSaveStatus = 'saved' | 'saving' | 'error';

export interface ChapterReviewOptions {
  chapter: ChapterRef;
  chapterRepository: ChapterTextRepository;
  revisionRepository: RevisionRepository;
  provider: SuggestionsProvider;
  /** Injectable in tests; defaults to a sequential id on Date.now. */
  newRequestId?: () => string;
}

export interface ChapterReviewController {
  loadState: ReviewLoadState;
  text: string;
  suggestions: readonly Suggestion[];
  pendingCount: number;
  pendingCountOf(kind: SuggestionKind): number;
  staleCount: number;
  canUndo: boolean;
  refining: boolean;
  /** The last refinement failed (provider unreachable or invalid output). */
  refineFailed: boolean;
  /** The last batch was born stale: the text changed during refinement. */
  refineBornStale: boolean;
  saveStatus: ReviewSaveStatus;
  refine(): Promise<void>;
  accept(suggestionId: string, proposalIndex?: number): Promise<void>;
  reject(suggestionId: string): Promise<void>;
  acceptAll(kind: SuggestionKind): Promise<void>;
  undo(): Promise<void>;
  applyManualEdit(newText: string): Promise<void>;
  /** Hand-typed text not confirmed yet: saved by itself after a pause, like dictation. */
  editDraft(text: string): void;
  /** Saves the pending hand-typed text right now (leaving the editor, refining). */
  flushDraft(): void;
}

// same generator as the other callables (idempotency, Firestore id charset)
const defaultRequestId = () => makeRequestId('ref');

export function useChapterReview(options: ChapterReviewOptions): ChapterReviewController {
  const { chapter, chapterRepository, revisionRepository, provider } = options;
  const newRequestId = options.newRequestId ?? defaultRequestId;

  const sessionRef = useRef<ReviewSession | null>(null);
  const [loadState, setLoadState] = useState<ReviewLoadState>('loading');
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineFailed, setRefineFailed] = useState(false);
  const [refineBornStale, setRefineBornStale] = useState(false);
  const [saveStatus, setSaveStatus] = useState<ReviewSaveStatus>('saved');

  // initial chapter load (like Dictation); the state already starts at
  // 'loading', so the effect must not reset anything synchronously
  useEffect(() => {
    let cancelled = false;
    chapterRepository
      .loadRawText(chapter)
      .then((rawText) => {
        if (cancelled) return;
        sessionRef.current = new ReviewSession({ initialText: rawText ?? '' });
        setText(sessionRef.current.text);
        setSuggestions(sessionRef.current.suggestions);
        setCanUndo(false);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('load-error');
      });
    return () => {
      cancelled = true;
    };
  }, [chapter, chapterRepository]);

  const syncFromSession = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setText(session.text);
    setSuggestions(session.suggestions);
    setCanUndo(session.canUndo);
  }, []);

  const persistText = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    setSaveStatus('saving');
    try {
      await chapterRepository.saveRawText(chapter, session.text);
      setSaveStatus('saved');
    } catch {
      // the text stays in the session: retry on the next change
      setSaveStatus('error');
    }
  }, [chapter, chapterRepository]);

  const refine = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || session.text === '') return;
    setRefining(true);
    setRefineFailed(false);
    setRefineBornStale(false);
    try {
      const raw = await provider.refine({
        bookId: chapter.bookId,
        chapterId: chapter.chapterId,
        text: session.text,
        textHash: textHash(session.text),
        requestId: newRequestId(),
      });
      // provider output validated at the boundary, even when the
      // provider is the fake: the contract is the same as the refineChapter callable's
      const result = refineResultSchema.parse(raw);
      const outcome = session.ingest(result);
      setRefineBornStale(outcome.bornStale);
      syncFromSession();
    } catch {
      setRefineFailed(true);
    } finally {
      setRefining(false);
    }
  }, [chapter, newRequestId, provider, syncFromSession]);

  const accept = useCallback(
    async (suggestionId: string, proposalIndex = 0) => {
      const session = sessionRef.current;
      if (!session) return;
      const outcome = session.accept(suggestionId, proposalIndex);
      syncFromSession();
      if (outcome.ok) {
        await persistText();
        await revisionRepository.append(chapter, outcome.revision).catch(() => {});
      }
    },
    [chapter, persistText, revisionRepository, syncFromSession],
  );

  const reject = useCallback(
    async (suggestionId: string) => {
      const session = sessionRef.current;
      if (!session) return;
      const outcome = session.reject(suggestionId);
      syncFromSession();
      if (outcome.ok) {
        await revisionRepository.append(chapter, outcome.revision).catch(() => {});
      }
    },
    [chapter, revisionRepository, syncFromSession],
  );

  const acceptAll = useCallback(
    async (kind: SuggestionKind) => {
      const session = sessionRef.current;
      if (!session) return;
      const outcome = session.acceptAll(kind);
      syncFromSession();
      if (outcome.accepted > 0) {
        await persistText();
        for (const revision of outcome.revisions) {
          await revisionRepository.append(chapter, revision).catch(() => {});
        }
      }
    },
    [chapter, persistText, revisionRepository, syncFromSession],
  );

  const undo = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const outcome = session.undo();
    syncFromSession();
    if (outcome.ok) {
      await persistText();
      for (const revisionId of outcome.removedRevisionIds) {
        await revisionRepository.remove(chapter, revisionId).catch(() => {});
      }
    }
  }, [chapter, persistText, revisionRepository, syncFromSession]);

  const applyManualEdit = useCallback(
    async (newText: string) => {
      const session = sessionRef.current;
      if (!session) return;
      const outcome = session.applyManualEdit(newText);
      syncFromSession();
      if (outcome.changed) {
        await persistText();
      }
    },
    [persistText, syncFromSession],
  );

  // The draft is applied through the same path as the ✓, so suggestions are
  // re-mapped/staled exactly the same; only the moment changes: after a pause
  // (3 s) and whenever the editor is left, never only on ✓.
  const draftSaverRef = useRef<DebouncedSaver | null>(null);
  useEffect(() => {
    const saver = new DebouncedSaver({ save: (draft) => applyManualEdit(draft) });
    draftSaverRef.current = saver;
    // locking the screen or switching app must not wait for the pause (dictation does the same)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') saver.flushNow();
    });
    // closing the whole flow (Android back, navigation) never drops typed text
    return () => {
      subscription.remove();
      saver.flushNow();
      draftSaverRef.current = null;
    };
  }, [applyManualEdit]);
  const editDraft = useCallback((draft: string) => draftSaverRef.current?.schedule(draft), []);
  const flushDraft = useCallback(() => draftSaverRef.current?.flushNow(), []);

  const pendingCount = suggestions.filter((s) => s.state === 'pending').length;
  const staleCount = suggestions.filter((s) => s.state === 'stale').length;
  const pendingCountOf = useCallback(
    (kind: SuggestionKind) =>
      suggestions.filter((s) => s.state === 'pending' && s.kind === kind).length,
    [suggestions],
  );

  return {
    loadState,
    text,
    suggestions,
    pendingCount,
    pendingCountOf,
    staleCount,
    canUndo,
    refining,
    refineFailed,
    refineBornStale,
    saveStatus,
    refine,
    accept,
    reject,
    acceptAll,
    undo,
    applyManualEdit,
    editDraft,
    flushDraft,
  };
}
