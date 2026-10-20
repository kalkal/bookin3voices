// Typing by hand in the editor must never be lost: before, the text lived only
// in the editor's local state and reached the repository only with the ✓.

import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import { ChapterReviewFlow } from '../ChapterReviewFlow';
import { FakeSuggestionsProvider } from '../FakeSuggestionsProvider';
import { InMemoryRevisionRepository } from '../revisions';

const CHAPTER = { bookId: 'libro', chapterId: 'cap-1' };
const ORIGINAL = 'Il mulino era fermo.';
const TYPED = 'Il mulino era fermo. Nora salì le scale.';
// long enough for the fake provider to find suggestions
const LONG =
  'Nora posò lentamente il telefono sul davanzale. aprì la finestra e mentre ' +
  'guardava la macchia sentì che qualcosa non andava. Prese un altra tazza dalla credenza.';

async function setup(onBack?: () => void, initialText = ORIGINAL) {
  const chapterRepository = new InMemoryChapterRepository();
  chapterRepository.seed(CHAPTER, initialText);
  const screen = await render(
    <ThemeProvider>
      <ChapterReviewFlow
        chapter={CHAPTER}
        chapterTitle="I · Il mulino"
        chapterRepository={chapterRepository}
        revisionRepository={new InMemoryRevisionRepository()}
        provider={new FakeSuggestionsProvider()}
        onBack={onBack}
      />
    </ThemeProvider>,
  );
  await screen.findByTestId('editor-text-p0');
  return { screen, chapterRepository };
}

async function typeByHand(screen: Awaited<ReturnType<typeof setup>>['screen'], text = TYPED) {
  await fireEvent.press(await screen.findByTestId('editor-edit-toggle'));
  await fireEvent.changeText(await screen.findByTestId('editor-input'), text);
}

describe('chapter editor — hand-typed text is never lost', () => {
  afterEach(() => jest.useRealTimers());

  it('leaving with the back arrow without pressing ✓ keeps the text', async () => {
    const onBack = jest.fn();
    const { screen, chapterRepository } = await setup(onBack);
    await typeByHand(screen);
    await fireEvent.press(screen.getByTestId('editor-back'));
    expect(onBack).toHaveBeenCalled();
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(TYPED);
    await screen.unmount();
  });

  it('closing the screen another way (Android back) keeps the text too', async () => {
    const { screen, chapterRepository } = await setup();
    await typeByHand(screen);
    await screen.unmount();
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(TYPED);
  });

  it('saves by itself a few seconds after the last keystroke, still editing', async () => {
    jest.useFakeTimers();
    const { screen, chapterRepository } = await setup();
    await typeByHand(screen);
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(ORIGINAL);
    await act(async () => {
      jest.advanceTimersByTime(3500);
    });
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(TYPED);
    expect(screen.getByTestId('editor-input')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('opening the suggestions without ✓ keeps the text', async () => {
    const { screen, chapterRepository } = await setup(undefined, LONG);
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await screen.findByTestId('editor-suggestions-chip');
    await typeByHand(screen, LONG + ' Nora salì le scale.');
    await fireEvent.press(screen.getByTestId('editor-suggestions-chip'));
    await screen.findByTestId('review-screen');
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(LONG + ' Nora salì le scale.');
    await screen.unmount();
  });

  it('saves when the app goes to the background before the pause is over', async () => {
    let onChange: ((state: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      listener: (state: string) => void,
    ) => {
      onChange = listener;
      return { remove: jest.fn() };
    }) as never);
    const { screen, chapterRepository } = await setup();
    await typeByHand(screen);
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(ORIGINAL);
    await act(async () => onChange?.('background'));
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(TYPED);
    await screen.unmount();
  });

  it('the ✓ still saves right away', async () => {
    const { screen, chapterRepository } = await setup();
    await typeByHand(screen);
    await fireEvent.press(screen.getByTestId('editor-edit-toggle'));
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(TYPED);
    await screen.unmount();
  });
});
