// Shape of the bundled sample book (judges' build). The content lives in
// content/sample-book/ and reaches the app as the generated sampleBookContent.ts.

import type { HistoryAspect, SuggestionKind } from '../review';

/**
 * A pre-recorded refine suggestion: like the model's output, it names the exact
 * text it applies to (`original`), never offsets; the span is located in the
 * chapter when the example is served, so it always matches the text.
 */
export interface ExampleSuggestion {
  kind: SuggestionKind;
  /** history only, as in the real contract. */
  aspect?: HistoryAspect;
  original: string;
  proposals: string[];
  rationale: string;
}

export interface SampleChapterContent {
  /** Fixed chapter id (sample-1, sample-2, ...). */
  id: string;
  title: string;
  text: string;
  outline: { summary: string; beats: string[] };
  examples: ExampleSuggestion[];
}

export interface SampleBookContent {
  /** Fixed book id: the same in every user's space. */
  id: string;
  title: string;
  author: string;
  description: string;
  synopsis: string;
  genre: string;
  styleProfileId: string;
  language: string;
  chapters: SampleChapterContent[];
}
