// Public API of the sample book feature (judges' build, EXPO_PUBLIC_SAMPLE_BOOK=1):
// bundled content, first-run seeding and the pre-recorded example refine.

export type { ExampleSuggestion, SampleBookContent, SampleChapterContent } from './types';
export { SAMPLE_BOOK_CONTENT } from './sampleBookContent';
export {
  isSampleBookEnabled,
  SAMPLE_BOOK_ID,
  SAMPLE_CHAPTER_IDS,
  sampleBookDocs,
  sampleChapter,
} from './sampleBook';
export { ensureSampleBook, sampleSeedMarkerKey, seedSampleBook } from './seedSampleBook';
export {
  createOfflineSampleRepositories,
  ExampleOnlySuggestionsProvider,
  NoExampleAvailableError,
} from './offlineSample';
export type { OfflineSampleRepositories } from './offlineSample';
export type { SampleBookSeedDeps, SampleSeedOutcome } from './seedSampleBook';
export {
  ExampleFallbackSuggestionsProvider,
  exampleRefineResult,
  isAiUnavailablePlaceholder,
} from './exampleRefine';
export type { ExampleFallbackSuggestionsProviderDeps, ExampleRefineOptions } from './exampleRefine';
