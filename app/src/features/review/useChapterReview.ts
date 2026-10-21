// Controller shared by the Chapter editor and Review: holds
// the ReviewSession (pure domain), text persistence (ChapterRepository,
// offline-first: every accepted patch is on disk immediately) and the history
// on `revisions` (RevisionRepository). The screens receive only this
// controller: never the SDK or the session directly.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ChapterRef, ChapterTextRepository } from '../chapters';
import { callableErrorMessage, logCallableFailure } from '../../lib/callableErrors';
import { makeRequestId } from '../../lib/requestId';
import { t, tn } from '../../i18n';
import { DebouncedSaver } from '../dictation/autosave';
import { logTestEvent } from '../testLog';
import { ReviewSession, type AcceptFailure } from './ReviewSession';
import type { RevisionRepository } from './revisions';
import { textHash } from './textHash';
import { rejectedKeys } from './rejections';
import { MIN_SELECTION_WORDS, selectionWords } from './selection';
import { refineResultSchema } from './types';
import type { Span, Suggestion, SuggestionKind, SuggestionsProvider } from './types';

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
  /** Plain message for the last failure, saying what to do next ('' when none). */
  refineErrorMessage: string;
  /** false when retrying the same request cannot help (e.g. a too-short selection). */
  refineErrorRetryable: boolean;
  /** The last batch was born stale: the text changed during refinement. */
  refineBornStale: boolean;
  saveStatus: ReviewSaveStatus;
  /** Plain message when an Accept was not applied (text left intact); '' otherwise. */
  acceptNotice: string;
  /** Refines the whole chapter, or only `range` («Rifinisci la selezione»). */
  refine(range?: Span): Promise<void>;
  /** Repeats the last refine; after an edit of the text, on the whole chapter (the Retry button). */
  retryRefine(): Promise<void>;
  /**
   * Checks a selection before leaving the editor: false (and the plain message)
   * when it is too short to refine, so the user still sees what they selected.
   */
  checkSelection(text: string, range: Span): boolean;
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

/** Plain message for an Accept that was not applied; '' when it was not about the text. */
export function acceptNoticeFor(reason: AcceptFailure): string {
  switch (reason) {
    case 'unsafe-proposal':
      return t('review.accept.unsafe');
    case 'original-mismatch':
    case 'span-out-of-range':
      return t('review.accept.mismatch');
    default:
      return '';
  }
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
  const [refineErrorMessage, setRefineErrorMessage] = useState('');
  const [refineErrorRetryable, setRefineErrorRetryable] = useState(true);
  const [refineBornStale, setRefineBornStale] = useState(false);
  const [saveStatus, setSaveStatus] = useState<ReviewSaveStatus>('saved');
  const [acceptNotice, setAcceptNotice] = useState('');

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

  // the range of the last refine, with the text it referred to: offsets are
  // meaningless on another text, so Retry then refines the whole chapter
  const lastRangeRef = useRef<{ range: Span; textHash: string } | undefined>(undefined);
  const refine = useCallback(
    async (range?: Span) => {
      const session = sessionRef.current;
      if (!session || session.text === '') return;
      lastRangeRef.current =
        range === undefined ? undefined : { range, textHash: textHash(session.text) };
      if (
        range !== undefined &&
        (range.to > session.text.length ||
          selectionWords(session.text, range) < MIN_SELECTION_WORDS)
      ) {
        // nothing is sent: a few words give the model nothing to work on
        setRefineBornStale(false);
        setRefineErrorRetryable(false);
        setRefineErrorMessage(t('review.editor.selectionTooShort', { count: MIN_SELECTION_WORDS }));
        return;
      }
      setRefining(true);
      setRefineErrorRetryable(true);
      setRefineErrorMessage('');
      setAcceptNotice('');
      setRefineBornStale(false);
      const requestId = newRequestId();
      try {
        // what the user already rejected is never proposed again (filtered by the server)
        const revisions = await revisionRepository.list(chapter).catch(() => {
          // refine anyway, but not silently: rejected pairs may come back this once
          console.warn('rejections-unavailable', { requestId });
          return [];
        });
        const rejected = rejectedKeys(revisions);
        const raw = await provider.refine({
          bookId: chapter.bookId,
          chapterId: chapter.chapterId,
          text: session.text,
          textHash: textHash(session.text),
          requestId,
          rejected,
          ...(range === undefined ? {} : { range }),
        });
        // provider output validated at the boundary, even when the
        // provider is the fake: the contract is the same as the refineChapter callable's
        const result = refineResultSchema.parse(raw);
        const outcome = session.ingest(result, range);
        setRefineBornStale(outcome.bornStale);
        syncFromSession();
      } catch (error) {
        // the text is untouched: the session only changes on a valid result
        logCallableFailure('refine', requestId, error);
        setRefineErrorMessage(callableErrorMessage('refine', error));
      } finally {
        setRefining(false);
      }
    },
    [chapter, newRequestId, provider, revisionRepository, syncFromSession],
  );
  const retryRefine = useCallback(() => {
    const last = lastRangeRef.current;
    const text = sessionRef.current?.text ?? '';
    return refine(last !== undefined && last.textHash === textHash(text) ? last.range : undefined);
  }, [refine]);
  const checkSelection = useCallback((text: string, range: Span) => {
    if (range.to <= text.length && selectionWords(text, range) >= MIN_SELECTION_WORDS) return true;
    setRefineBornStale(false);
    setRefineErrorRetryable(false);
    setRefineErrorMessage(t('review.editor.selectionTooShort', { count: MIN_SELECTION_WORDS }));
    return false;
  }, []);

  const accept = useCallback(
    async (suggestionId: string, proposalIndex = 0) => {
      const session = sessionRef.current;
      if (!session) return;
      const target = session.suggestions.find((s) => s.id === suggestionId);
      const outcome = session.accept(suggestionId, proposalIndex);
      logTestEvent('suggestion.accept', {
        chapterId: chapter.chapterId,
        suggestionId,
        kind: target?.kind,
        proposalIndex,
        before: target?.original,
        after: target?.proposals[proposalIndex],
        ok: outcome.ok,
        ...(outcome.ok ? {} : { reason: outcome.reason }),
      });
      syncFromSession();
      if (!outcome.ok) {
        // never silent, never the text: the id carries the refinement's requestId
        console.warn('accept-skipped', { suggestionId, reason: outcome.reason });
        setAcceptNotice(acceptNoticeFor(outcome.reason));
        return;
      }
      setAcceptNotice('');
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
      const target = session.suggestions.find((s) => s.id === suggestionId);
      const outcome = session.reject(suggestionId);
      logTestEvent('suggestion.reject', {
        chapterId: chapter.chapterId,
        suggestionId,
        kind: target?.kind,
        original: target?.original,
        proposal: target?.proposals[0],
        rationale: target?.rationale,
        ok: outcome.ok,
      });
      syncFromSession();
      setAcceptNotice('');
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
      logTestEvent('suggestion.acceptAll', {
        chapterId: chapter.chapterId,
        kind,
        accepted: outcome.accepted,
        staled: outcome.staled,
        changes: outcome.revisions.map((r) => ({ before: r.before, after: r.after })),
      });
      syncFromSession();
      const skipped = outcome.unsafe + outcome.staled;
      if (skipped > 0) {
        console.warn('accept-all-skipped', {
          kind,
          unsafe: outcome.unsafe,
          staled: outcome.staled,
        });
      }
      setAcceptNotice(skipped > 0 ? tn('review.accept.skipped', skipped) : '');
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
    logTestEvent('suggestion.undo', {
      chapterId: chapter.chapterId,
      ok: outcome.ok,
      ...(outcome.ok
        ? { patches: outcome.patches.map((p) => ({ before: p.before, after: p.after })) }
        : { reason: outcome.reason }),
    });
    syncFromSession();
    setAcceptNotice('');
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
    refineFailed: refineErrorMessage !== '',
    refineErrorMessage,
    refineErrorRetryable,
    refineBornStale,
    saveStatus,
    acceptNotice,
    refine,
    retryRefine,
    checkSelection,
    accept,
    reject,
    acceptAll,
    undo,
    applyManualEdit,
    editDraft,
    flushDraft,
  };
}
