/**
 * Chapter editor ⇄ suggestion Review flow:
 * owns the shared controller and alternates the two screens. When real
 * navigation arrives (Library → Book → Editor), the screens mount
 * as routes passing the same controller; this component remains the
 * convenient entry point for testing and development.
 */
import { useState } from 'react';

import type { ChapterPatch, ChapterRef, ChapterTextRepository, KeyValueStorage } from '../chapters';
import { OutlineTrack, type OutlineTrackRepository } from '../dictation/OutlineTrack';
import { ChapterEditorScreen } from './ChapterEditorScreen';
import { ReviewScreen } from './ReviewScreen';
import type { RevisionRepository } from './revisions';
import type { TitleRefineService } from './titles';
import type { SuggestionsProvider } from './types';
import { useTitleRefine } from './useTitleRefine';
import { useChapterReview } from './useChapterReview';

export interface ChapterReviewFlowProps {
  chapter: ChapterRef;
  /** E.g. "VII · La piena". */
  chapterTitle?: string;
  chapterRepository: ChapterTextRepository;
  revisionRepository: RevisionRepository;
  provider: SuggestionsProvider;
  /** If present, the Editor shows the back chevron to the Book. */
  onBack?: () => void;
  /** If present, Editor and Review show the chapter's key beats, as Dictation does. */
  outlineRepository?: OutlineTrackRepository;
  /** Storage of the beats panel's open/closed choice (tests); default AsyncStorage. */
  outlineStateStorage?: KeyValueStorage;
  /** The chapter's own title (without the numeral), for «Rifinisci il titolo». */
  chapterName?: string;
  /** refineTitle callable; absent = the title cannot be refined. */
  titleService?: TitleRefineService;
  /** Where a chosen title is saved. */
  titleRepository?: { updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void> };
}

export function ChapterReviewFlow({
  chapter,
  chapterTitle,
  chapterRepository,
  revisionRepository,
  provider,
  onBack,
  outlineRepository,
  outlineStateStorage,
  chapterName,
  titleService,
  titleRepository,
}: ChapterReviewFlowProps) {
  const title = useTitleRefine({
    chapter,
    name: chapterName ?? '',
    service: titleService,
    repository: titleRepository,
  });
  const controller = useChapterReview({
    chapter,
    chapterRepository,
    revisionRepository,
    provider,
  });
  const [screen, setScreen] = useState<'editor' | 'review'>('editor');

  // the same panel as in Dictation: "VII · La piena" → "Traccia · VII"
  const outlinePanel =
    outlineRepository === undefined ? undefined : (
      <OutlineTrack
        chapter={chapter}
        repository={outlineRepository}
        chapterLabel={chapterTitle?.split('·')[0]?.trim()}
        storage={outlineStateStorage}
      />
    );

  if (screen === 'review') {
    return (
      <ReviewScreen
        controller={controller}
        chapterLabel={chapterTitle}
        onBack={() => setScreen('editor')}
        outlinePanel={outlinePanel}
      />
    );
  }
  return (
    <ChapterEditorScreen
      controller={controller}
      chapterTitle={chapterTitle}
      title={title}
      onOpenReview={() => setScreen('review')}
      onBack={onBack}
      outlinePanel={outlinePanel}
    />
  );
}
