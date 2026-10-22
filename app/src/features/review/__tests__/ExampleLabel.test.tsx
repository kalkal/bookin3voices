import { fireEvent, render } from '@testing-library/react-native';
import { FirebaseError } from 'firebase/app';

import { setLanguage } from '../../../i18n';
import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import {
  ExampleFallbackSuggestionsProvider,
  isAiUnavailablePlaceholder,
} from '../../sample/exampleRefine';
import { SAMPLE_BOOK_CONTENT } from '../../sample/sampleBookContent';
import { SAMPLE_BOOK_ID } from '../../sample/sampleBook';
import { ChapterReviewFlow } from '../ChapterReviewFlow';
import { FakeSuggestionsProvider } from '../FakeSuggestionsProvider';
import { InMemoryRevisionRepository } from '../revisions';
import type { SuggestionsProvider } from '../types';

const [FIRST] = SAMPLE_BOOK_CONTENT.chapters;
const CHAPTER = { bookId: SAMPLE_BOOK_ID, chapterId: FIRST.id };

async function setup(text: string, provider: SuggestionsProvider) {
  const chapterRepository = new InMemoryChapterRepository();
  chapterRepository.seed(CHAPTER, text);
  const screen = await render(
    <ThemeProvider>
      <ChapterReviewFlow
        chapter={CHAPTER}
        chapterTitle={`I · ${FIRST.title}`}
        chapterRepository={chapterRepository}
        revisionRepository={new InMemoryRevisionRepository()}
        provider={provider}
      />
    </ThemeProvider>,
  );
  // «Rifinisci» opens the refine panel first (#36); «Avvia» sends the request
  await fireEvent.press(await screen.findByTestId('editor-refine'));
  await fireEvent.press(await screen.findByTestId('refine-start'));
  await screen.findByTestId('editor-suggestions-chip');
  return screen;
}

const aiDown = new ExampleFallbackSuggestionsProvider({
  inner: {
    refine: async () => {
      throw new FirebaseError('functions/unavailable', 'down');
    },
  },
  isAiUnavailable: isAiUnavailablePlaceholder,
});

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  setLanguage('it');
});

describe('example mode label', () => {
  it('pre-recorded examples are labelled in the editor, on the review screen and on every card', async () => {
    const screen = await setup(FIRST.text, aiDown);
    expect(screen.getByTestId('editor-example-label')).toHaveTextContent(
      /Esempio — registrato, non AI dal vivo/,
    );
    // not a failure: the examples stand in, and say so
    expect(screen.queryByTestId('editor-refine-error')).toBeNull();

    await fireEvent.press(screen.getByTestId('editor-suggestions-chip'));
    expect(await screen.findByTestId('review-example-label')).toHaveTextContent(
      /Esempio — registrato, non AI dal vivo/,
    );
    for (const index of FIRST.examples.keys()) {
      const id = `example-${FIRST.id}-${index + 1}`;
      expect(screen.getByTestId(`review-card-example-${id}`)).toBeOnTheScreen();
    }
  });

  it('reads in English with the English interface', async () => {
    setLanguage('en');
    const screen = await setup(FIRST.text, aiDown);
    expect(screen.getByTestId('editor-example-label')).toHaveTextContent(
      /Example — pre-recorded, not live AI/,
    );
  });

  it('live suggestions never carry the label', async () => {
    const screen = await setup(
      'Nora posò lentamente il telefono sul davanzale. Prese un altra tazza dalla credenza.',
      new FakeSuggestionsProvider(),
    );
    expect(screen.queryByTestId('editor-example-label')).toBeNull();
    await fireEvent.press(screen.getByTestId('editor-suggestions-chip'));
    expect(await screen.findByTestId('review-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('review-example-label')).toBeNull();
    expect(screen.queryByTestId(/^review-card-example-/)).toBeNull();
  });
});
