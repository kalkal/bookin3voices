/**
 * Chapter editor ⇄ suggestion Review flow:
 * owns the shared controller and alternates the two screens. When real
 * navigation arrives (Library → Book → Editor), the screens mount
 * as routes passing the same controller; this component remains the
 * convenient entry point for testing and development.
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
  /** E.g. "VII · La marea". */
  chapterTitle?: string;
  chapterRepository: ChapterTextRepository;
  revisionRepository: RevisionRepository;
  provider: SuggestionsProvider;
  /** If present, the Editor shows the back chevron to the Book. */
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
