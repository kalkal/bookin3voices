import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import { ChapterReviewFlow } from '../ChapterReviewFlow';
import { FakeSuggestionsProvider } from '../FakeSuggestionsProvider';
import { InMemoryRevisionRepository } from '../revisions';
import { textHash } from '../textHash';
import { FirebaseError } from 'firebase/app';

import type { RefineResult, SuggestionsProvider } from '../types';

const CHAPTER = { bookId: 'libro', chapterId: 'cap-1' };

const BRANO =
  'Nora posò lentamente il telefono sul davanzale. aprì la finestra e mentre ' +
  'guardava la macchia sentì che qualcosa non andava. Prese un altra tazza dalla credenza.';

/** Suggestions the fake provider will generate on BRANO (deterministic ids). */
async function previewSuggestions(): Promise<RefineResult> {
  return new FakeSuggestionsProvider().refine({
    ...CHAPTER,
    text: BRANO,
    textHash: textHash(BRANO),
    requestId: 'preview',
  });
}

async function setup(
  initialText = BRANO,
  provider: SuggestionsProvider = new FakeSuggestionsProvider(),
) {
  const chapterRepository = new InMemoryChapterRepository();
  chapterRepository.seed(CHAPTER, initialText);
  const revisionRepository = new InMemoryRevisionRepository();
  const screen = await render(
    <ThemeProvider>
      <ChapterReviewFlow
        chapter={CHAPTER}
        chapterTitle="VII · La piena"
        chapterRepository={chapterRepository}
        revisionRepository={revisionRepository}
        provider={provider}
      />
    </ThemeProvider>,
  );
  return { screen, chapterRepository, revisionRepository };
}

describe('ChapterReviewFlow — the key beats of the chapter', () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: async (key: string) => data.get(key) ?? null,
      setItem: async (key: string) => {
        data.set(key, '');
      },
    };
  }

  it('the Editor and the Review both show the beats, as in Dictation', async () => {
    const chapterRepository = new InMemoryChapterRepository();
    chapterRepository.seed(CHAPTER, BRANO, {
      outline: {
        summary: 'Nora e la macchia.',
        beats: ['La macchia sul muro', 'La tazza'],
        beatsDone: [],
      },
    });
    const screen = await render(
      <ThemeProvider>
        <ChapterReviewFlow
          chapter={CHAPTER}
          chapterTitle="VII · La piena"
          chapterRepository={chapterRepository}
          outlineRepository={chapterRepository}
          outlineStateStorage={memoryStorage()}
          revisionRepository={new InMemoryRevisionRepository()}
          provider={new FakeSuggestionsProvider()}
        />
      </ThemeProvider>,
    );
    await screen.findByTestId('editor-text-p0');
    expect(await screen.findByTestId('outline-beat-0')).toHaveTextContent(/La macchia sul muro/);
    expect(screen.getByTestId('outline-track')).toHaveTextContent(/Traccia · VII/);

    await fireEvent.press(screen.getByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));
    expect(await screen.findByTestId('review-screen')).toBeOnTheScreen();
    expect(await screen.findByTestId('outline-beat-1')).toHaveTextContent(/La tazza/);
    await screen.unmount();
  });
});

describe('ChapterReviewFlow — AI unreachable', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refine failing (expired cloud credentials): plain message, text kept, Retry works', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = new FakeSuggestionsProvider();
    let failNext = true;
    const provider: SuggestionsProvider = {
      refine: async (request) => {
        if (failNext) {
          failNext = false;
          throw new FirebaseError('functions/internal', 'The security token is expired');
        }
        return fake.refine(request);
      },
    };
    const { screen } = await setup(BRANO, provider);
    await screen.findByTestId('editor-text-p0');
    await fireEvent.press(await screen.findByTestId('editor-refine'));

    const banner = await screen.findByTestId('editor-refine-error');
    expect(banner).toHaveTextContent(/I suggerimenti non sono arrivati\. Riprova tra poco\./);
    expect(banner).not.toHaveTextContent(/token/);
    expect(screen.getByTestId('editor-text-p0')).toHaveTextContent(/lentamente il telefono/);
    // structured log: requestId and code, never the chapter text
    expect(warn).toHaveBeenCalledWith(
      'callable-failed',
      expect.objectContaining({ action: 'refine', code: 'internal' }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/lentamente il telefono/);

    await fireEvent.press(screen.getByTestId('editor-refine-retry'));
    expect(await screen.findByTestId('editor-suggestions-chip')).toBeOnTheScreen();
    expect(screen.queryByTestId('editor-refine-error')).toBeNull();
    await screen.unmount();
  });
});

describe('ChapterReviewFlow (editor + review)', () => {
  it('Rifinisci generates the suggestions: counter chip and inline highlights', async () => {
    const { screen } = await setup();
    const preview = await previewSuggestions();
    expect(preview.suggestions.length).toBeGreaterThanOrEqual(4);

    await screen.findByTestId('editor-text-p0'); // chapter loaded: button enabled
    await fireEvent.press(await screen.findByTestId('editor-refine'));

    const chip = await screen.findByTestId('editor-suggestions-chip');
    expect(chip).toHaveTextContent(`${preview.suggestions.length} suggerimenti`);
    for (const suggestion of preview.suggestions) {
      expect(screen.getByTestId(`highlight-${suggestion.id}`)).toHaveTextContent(
        // the drop-cap glyph may live in the same Text: the content is enough
        new RegExp(escapeRegExp(suggestion.original.trim())),
      );
    }
    await screen.unmount();
  });

  it('accepting a card updates the text, persists and writes the revision; undo reverts it', async () => {
    const { screen, chapterRepository, revisionRepository } = await setup();
    const preview = await previewSuggestions();
    const elision = preview.suggestions.find((s) => s.original === 'un altra');
    if (!elision) throw new Error('elision suggestion missing');

    await screen.findByTestId('editor-text-p0'); // chapter loaded: button enabled
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));

    await fireEvent.press(await screen.findByTestId(`review-accept-${elision.id}`));
    await waitFor(async () => {
      expect(await chapterRepository.loadRawText(CHAPTER)).toContain("un'altra tazza");
    });
    const revisions = await revisionRepository.list(CHAPTER);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      before: 'un altra',
      after: "un'altra",
      decision: 'accepted',
    });
    expect(screen.queryByTestId(`review-accept-${elision.id}`)).toBeNull();

    await fireEvent.press(await screen.findByTestId('review-undo'));
    await waitFor(async () => {
      expect(await chapterRepository.loadRawText(CHAPTER)).toBe(BRANO);
    });
    expect(await revisionRepository.list(CHAPTER)).toHaveLength(0);
    expect(await screen.findByTestId(`review-accept-${elision.id}`)).toBeOnTheScreen();
    await screen.unmount();
  });

  it('rejecting a card writes the rejected revision without touching the text', async () => {
    const { screen, chapterRepository, revisionRepository } = await setup();
    const preview = await previewSuggestions();
    const elision = preview.suggestions.find((s) => s.original === 'un altra');
    if (!elision) throw new Error('elision suggestion missing');

    await screen.findByTestId('editor-text-p0'); // chapter loaded: button enabled
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));
    await fireEvent.press(await screen.findByTestId(`review-reject-${elision.id}`));

    await waitFor(async () => {
      expect(await revisionRepository.list(CHAPTER)).toHaveLength(1);
    });
    expect((await revisionRepository.list(CHAPTER))[0].decision).toBe('rejected');
    expect(await chapterRepository.loadRawText(CHAPTER)).toBe(BRANO);
    await screen.unmount();
  });

  it('style variants are chosen via chips: accepting applies the chosen one', async () => {
    const { screen, chapterRepository } = await setup();
    const preview = await previewSuggestions();
    const adverb = preview.suggestions.find((s) => s.original === 'posò lentamente');
    if (!adverb) throw new Error('adverb suggestion missing');
    expect(adverb.proposals).toHaveLength(3);

    await screen.findByTestId('editor-text-p0'); // chapter loaded: button enabled
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));

    await fireEvent.press(await screen.findByTestId(`review-variant-${adverb.id}-1`));
    await fireEvent.press(await screen.findByTestId(`review-accept-${adverb.id}`));
    await waitFor(async () => {
      expect(await chapterRepository.loadRawText(CHAPTER)).toContain('posò, piano, il telefono');
    });
    await screen.unmount();
  });

  it('«accetta tutti» of the category applies all the grammar patches', async () => {
    const { screen, chapterRepository, revisionRepository } = await setup();

    await screen.findByTestId('editor-text-p0'); // chapter loaded: button enabled
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));
    await fireEvent.press(await screen.findByTestId('review-filter-grammar'));
    await fireEvent.press(await screen.findByTestId('review-accept-all'));

    await waitFor(async () => {
      const saved = await chapterRepository.loadRawText(CHAPTER);
      expect(saved).toContain("un'altra tazza");
      expect(saved).toContain('. Aprì la finestra');
    });
    const revisions = await revisionRepository.list(CHAPTER);
    expect(revisions.filter((r) => r.decision === 'accepted')).toHaveLength(2);
    // a single undo reverts both (composite command)
    await fireEvent.press(await screen.findByTestId('review-undo'));
    await waitFor(async () => {
      expect(await chapterRepository.loadRawText(CHAPTER)).toBe(BRANO);
    });
    await screen.unmount();
  });

  it('history: the Storico filter shows a period detail and an anachronism, both «to check»', async () => {
    const scene =
      'Napoli, 1943. La strada era deserta sotto la luna. ' +
      'Nel basso, la madre accese il televisore per sentire le notizie.';
    const { screen, chapterRepository } = await setup(scene);

    await screen.findByTestId('editor-text-p0'); // chapter loaded: button enabled
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));

    const filter = await screen.findByTestId('review-filter-history');
    expect(filter).toHaveTextContent('Storico');
    await fireEvent.press(filter);

    const preview = await new FakeSuggestionsProvider().refine({
      ...CHAPTER,
      text: scene,
      textHash: textHash(scene),
      requestId: 'preview',
    });
    const tip = preview.suggestions.find((s) => s.aspect === 'period');
    const anachronism = preview.suggestions.find((s) => s.aspect === 'anachronism');
    if (!tip || !anachronism) throw new Error('history suggestions missing');
    expect(screen.getByTestId(`review-aspect-${tip.id}`)).toHaveTextContent('Dettaglio d’epoca');
    expect(screen.getByTestId(`review-aspect-${anachronism.id}`)).toHaveTextContent(
      'Possibile anacronismo',
    );
    expect(screen.getByTestId(`review-to-check-${anachronism.id}`)).toHaveTextContent(
      /da verificare/i,
    );

    await fireEvent.press(await screen.findByTestId(`review-accept-${anachronism.id}`));
    await waitFor(async () => {
      expect(await chapterRepository.loadRawText(CHAPTER)).toContain('la madre accese la radio');
    });
    await screen.unmount();
  });

  it('history: no «accept all» under the Storico filter, hints are accepted one at a time', async () => {
    const scene =
      'Napoli, 1943. La strada era deserta sotto la luna. ' +
      'Nel basso, la madre accese il televisore per sentire le notizie.';
    const { screen } = await setup(scene);

    await screen.findByTestId('editor-text-p0');
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));
    await fireEvent.press(await screen.findByTestId('review-filter-history'));

    expect(screen.queryByTestId('review-accept-all')).toBeNull();
    expect(screen.getByTestId('review-history-one-by-one')).toHaveTextContent(
      'Gli spunti storici si accettano uno alla volta.',
    );
    await screen.unmount();
  });

  it('a manual edit touching a span invalidates the suggestion (stale)', async () => {
    const { screen } = await setup();
    const preview = await previewSuggestions();
    const elision = preview.suggestions.find((s) => s.original === 'un altra');
    if (!elision) throw new Error('elision suggestion missing');

    await screen.findByTestId('editor-text-p0'); // chapter loaded: button enabled
    await fireEvent.press(await screen.findByTestId('editor-refine'));

    // the user hand-corrects exactly there: 'un altra' → 'una nuova'
    await fireEvent.press(await screen.findByTestId('editor-edit-toggle'));
    const input = await screen.findByTestId('editor-input');
    await fireEvent.changeText(input, BRANO.replace('un altra', 'una nuova'));
    await fireEvent.press(await screen.findByTestId('editor-edit-toggle'));

    // the elision highlight disappears, the others stay
    await waitFor(() => {
      expect(screen.queryByTestId(`highlight-${elision.id}`)).toBeNull();
    });
    const adverb = preview.suggestions.find((s) => s.original === 'posò lentamente');
    expect(screen.getByTestId(`highlight-${adverb!.id}`)).toBeOnTheScreen();

    // and the Review shows the note about suggestions no longer applicable
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));
    expect(await screen.findByTestId('review-stale-note')).toHaveTextContent(
      /non è più applicabile/,
    );
    await screen.unmount();
  });

  it('empty chapter: Rifinisci disabled and prompt to dictate', async () => {
    const { screen } = await setup('');
    expect(await screen.findByTestId('editor-empty-hint')).toBeOnTheScreen();
    const refine = await screen.findByTestId('editor-refine');
    expect(refine).toBeDisabled();
    await screen.unmount();
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
