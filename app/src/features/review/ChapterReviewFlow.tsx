/**
 * Flusso Editor capitolo ⇄ Review suggerimenti:
 * possiede il controller condiviso e alterna le due schermate. Quando arriverà
 * la navigazione vera (Libreria → Libro → Editor), le schermate si montano
 * come route passando lo stesso controller; questo componente resta il punto
 * d'ingresso comodo per collaudo e sviluppo.
 */
import { useState } from 'react';

import type { ChapterRef, ChapterTextRepository } from '../chapters';
import { ChapterEditorScreen } from './ChapterEditorScreen';
import { ReviewScreen } from './ReviewScreen';
import type { RevisionRepository } from './revisions';
import type { SuggestionsProvider } from './types';
import { useChapterReview } from './useChapterReview';

export interface ChapterReviewFlowProps {
  chapter: ChapterRef;
  /** Es. "VII · La marea". */
  chapterTitle?: string;
  chapterRepository: ChapterTextRepository;
  revisionRepository: RevisionRepository;
  provider: SuggestionsProvider;
  /** Se presente, l'Editor mostra il chevron di ritorno al Libro. */
  onBack?: () => void;
}

export function ChapterReviewFlow({
  chapter,
  chapterTitle,
  chapterRepository,
  revisionRepository,
  provider,
  onBack,
}: ChapterReviewFlowProps) {
  const controller = useChapterReview({
    chapter,
    chapterRepository,
    revisionRepository,
    provider,
  });
  const [screen, setScreen] = useState<'editor' | 'review'>('editor');

  if (screen === 'review') {
    return (
      <ReviewScreen
        controller={controller}
        chapterLabel={chapterTitle}
        onBack={() => setScreen('editor')}
      />
    );
  }
  return (
    <ChapterEditorScreen
      controller={controller}
      chapterTitle={chapterTitle}
      onOpenReview={() => setScreen('review')}
      onBack={onBack}
    />
  );
}
