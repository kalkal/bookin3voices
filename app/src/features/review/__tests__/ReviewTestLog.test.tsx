// Dev test log: what the user did with each suggestion, with before/after.

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { captureTestLog } from '../../../testing/testLog';
import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import { uninstallTestLog } from '../../testLog';
import { ChapterReviewFlow } from '../ChapterReviewFlow';
import { FakeSuggestionsProvider } from '../FakeSuggestionsProvider';
import { InMemoryRevisionRepository } from '../revisions';
import { textHash } from '../textHash';

const CHAPTER = { bookId: 'libro', chapterId: 'cap-1' };
const BRANO =
  'Nora posò lentamente il telefono sul davanzale. aprì la finestra e mentre ' +
  'guardava la macchia sentì che qualcosa non andava. Prese un altra tazza dalla credenza.';

async function setup() {
  const chapterRepository = new InMemoryChapterRepository();
  chapterRepository.seed(CHAPTER, BRANO);
  const screen = await render(
    <ThemeProvider>
      <ChapterReviewFlow
        chapter={CHAPTER}
        chapterTitle="VII · La piena"
        chapterRepository={chapterRepository}
        revisionRepository={new InMemoryRevisionRepository()}
        provider={new FakeSuggestionsProvider()}
      />
    </ThemeProvider>,
  );
  const preview = await new FakeSuggestionsProvider().refine({
    ...CHAPTER,
    text: BRANO,
    textHash: textHash(BRANO),
    requestId: 'preview',
  });
  const elision = preview.suggestions.find((s) => s.original === 'un altra');
  if (!elision) throw new Error('elision suggestion missing');
  await screen.findByTestId('editor-text-p0');
  await fireEvent.press(await screen.findByTestId('editor-refine'));
  await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));
  return { screen, chapterRepository, elision };
}

afterEach(() => uninstallTestLog());

describe('review actions in the dev test log', () => {
  it('records accept and undo with the before/after text', async () => {
    const log = captureTestLog();
    const { screen, chapterRepository, elision } = await setup();

    await fireEvent.press(await screen.findByTestId(`review-accept-${elision.id}`));
    await waitFor(async () => {
      expect(await chapterRepository.loadRawText(CHAPTER)).toContain("un'altra");
    });
    expect(log.events('suggestion.accept')[0]).toMatchObject({
      chapterId: 'cap-1',
      suggestionId: elision.id,
      kind: elision.kind,
      proposalIndex: 0,
      before: 'un altra',
      after: "un'altra",
      ok: true,
    });

    await fireEvent.press(await screen.findByTestId('review-undo'));
    await waitFor(() => expect(log.events('suggestion.undo')).toHaveLength(1));
    expect(log.events('suggestion.undo')[0]).toMatchObject({
      chapterId: 'cap-1',
      ok: true,
      patches: [{ before: "un'altra", after: 'un altra' }],
    });
    await screen.unmount();
  });

  it('records a rejection with the proposal that was turned down', async () => {
    const log = captureTestLog();
    const { screen, elision } = await setup();

    await fireEvent.press(await screen.findByTestId(`review-reject-${elision.id}`));
    await waitFor(() => expect(log.events('suggestion.reject')).toHaveLength(1));
    expect(log.events('suggestion.reject')[0]).toMatchObject({
      suggestionId: elision.id,
      kind: elision.kind,
      original: 'un altra',
      proposal: "un'altra",
      ok: true,
    });
    await screen.unmount();
  });
});
