// Controller condiviso da Editor capitolo e Review: tiene
// la ReviewSession (dominio puro), la persistenza del testo (ChapterRepository,
// offline-first: ogni patch accettata è subito su disco) e lo storico su
// `revisions` (RevisionRepository). Le schermate ricevono solo questo
// controller: mai SDK o session direttamente.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChapterRef, ChapterTextRepository } from '../chapters';
import { makeRequestId } from '../../lib/requestId';
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
  /** Iniettabile nei test; default id progressivo su Date.now. */
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
  /** L'ultima rifinitura è fallita (provider irraggiungibile o output non valido). */
  refineFailed: boolean;
  /** L'ultimo lotto è nato stale: il testo è cambiato durante la rifinitura. */
  refineBornStale: boolean;
  saveStatus: ReviewSaveStatus;
  refine(): Promise<void>;
  accept(suggestionId: string, proposalIndex?: number): Promise<void>;
  reject(suggestionId: string): Promise<void>;
  acceptAll(kind: SuggestionKind): Promise<void>;
  undo(): Promise<void>;
  applyManualEdit(newText: string): Promise<void>;
}

// stesso generatore delle altre callable (idempotenza, charset id Firestore)
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

  // caricamento iniziale del capitolo (come la Dettatura); lo stato parte
  // già da 'loading', quindi l'effetto non deve resettare nulla in sincrono
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
      // il testo resta in sessione: si riprova alla prossima modifica
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
      // output del provider validato al confine (standard tecnici), anche
      // quando il provider è il finto: il contratto è lo stesso della callable refineChapter
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
  };
}
