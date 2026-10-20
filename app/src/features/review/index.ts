// Public API of the review feature: suggestion domain types
// shared with the refineChapter function, Command pattern with undo, fake
// provider, and the Editor/Review Editor/Review screens.

export {
  HISTORY_ASPECT_LABELS,
  HISTORY_ASPECTS,
  KIND_LABELS,
  refineResultSchema,
  spanSchema,
  SUGGESTION_KINDS,
  SUGGESTION_STATES,
  suggestionSchema,
} from './types';
export type {
  HistoryAspect,
  RefineRequest,
  RefineResult,
  Span,
  Suggestion,
  SuggestionKind,
  SuggestionState,
  SuggestionsProvider,
} from './types';
export { textHash } from './textHash';
export { applyPatch, diffAsPatch, invertPatch, remapSpan } from './patches';
export type { PatchFailure, PatchResult, TextPatch } from './patches';
export { ReviewSession } from './ReviewSession';
export type {
  AcceptAllOutcome,
  AcceptFailure,
  AcceptOutcome,
  IngestOutcome,
  ManualEditOutcome,
  RejectOutcome,
  ReviewSessionOptions,
  RevisionRecord,
  UndoOutcome,
} from './ReviewSession';
export { InMemoryRevisionRepository, LocalRevisionRepository } from './revisions';
export type { RevisionRepository } from './revisions';
export { CallableSuggestionsProvider } from './CallableSuggestionsProvider';
export type { CallableSuggestionsProviderDeps } from './CallableSuggestionsProvider';
export { FakeSuggestionsProvider } from './FakeSuggestionsProvider';
export type { FakeSuggestionsProviderOptions } from './FakeSuggestionsProvider';
export { useChapterReview } from './useChapterReview';
export type {
  ChapterReviewController,
  ChapterReviewOptions,
  ReviewLoadState,
  ReviewSaveStatus,
} from './useChapterReview';
export { HighlightedChapterText } from './HighlightedChapterText';
export { ChapterEditorScreen } from './ChapterEditorScreen';
export type { ChapterEditorScreenProps } from './ChapterEditorScreen';
export { ReviewScreen } from './ReviewScreen';
export type { ReviewScreenProps } from './ReviewScreen';
export { ChapterReviewFlow } from './ChapterReviewFlow';
export type { ChapterReviewFlowProps } from './ChapterReviewFlow';
