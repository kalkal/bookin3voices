import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import { ChapterReviewFlow } from '../ChapterReviewFlow';
import { FakeSuggestionsProvider } from '../FakeSuggestionsProvider';
import { InMemoryRevisionRepository } from '../revisions';
import { textHash } from '../textHash';
import type { RefineResult } from '../types';

const CHAPTER = { bookId: 'libro', chapterId: 'cap-1' };

const BRANO =
  'Irene posò lentamente il bicchiere nel lavello. aprì il rubinetto e mentre ' +
  'beveva sentì che qualcosa non andava. Prese un altra tazza dallo scolapiatti.';

/** Suggerimenti che il provider finto genererà su BRANO (id deterministici). */
async function previewSuggestions(): Promise<RefineResult> {
  return new FakeSuggestionsProvider().refine({
    ...CHAPTER,
    text: BRANO,
    textHash: textHash(BRANO),
    requestId: 'preview',
  });
}

async function setup(initialText = BRANO) {
  const chapterRepository = new InMemoryChapterRepository();
  chapterRepository.seed(CHAPTER, initialText);
  const revisionRepository = new InMemoryRevisionRepository();
  const screen = await render(
    <ThemeProvider>
      <ChapterReviewFlow
        chapter={CHAPTER}
        chapterTitle="VII · La marea"
        chapterRepository={chapterRepository}
        revisionRepository={revisionRepository}
        provider={new FakeSuggestionsProvider()}
      />
    </ThemeProvider>,
  );
  return { screen, chapterRepository, revisionRepository };
}

describe('ChapterReviewFlow (editor + review)', () => {
  it('Rifinisci genera i suggerimenti: chip contatore ed evidenziazioni inline', async () => {
    const { screen } = await setup();
    const preview = await previewSuggestions();
    expect(preview.suggestions.length).toBeGreaterThanOrEqual(4);

    await screen.findByTestId('editor-text-p0'); // capitolo caricato: bottone attivo
    await fireEvent.press(await screen.findByTestId('editor-refine'));

    const chip = await screen.findByTestId('editor-suggestions-chip');
    expect(chip).toHaveTextContent(`${preview.suggestions.length} suggerimenti`);
    for (const suggestion of preview.suggestions) {
      expect(screen.getByTestId(`highlight-${suggestion.id}`)).toHaveTextContent(
        // il glifo del capolettera può stare nello stesso Text: basta il contenuto
        new RegExp(escapeRegExp(suggestion.original.trim())),
      );
    }
    await screen.unmount();
  });

  it('accettare una card aggiorna il testo, persiste e scrive la revisione; undo la annulla', async () => {
    const { screen, chapterRepository, revisionRepository } = await setup();
    const preview = await previewSuggestions();
    const elision = preview.suggestions.find((s) => s.original === 'un altra');
    if (!elision) throw new Error('manca il suggerimento di elisione');

    await screen.findByTestId('editor-text-p0'); // capitolo caricato: bottone attivo
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

  it('rifiutare una card scrive la revisione rejected senza toccare il testo', async () => {
    const { screen, chapterRepository, revisionRepository } = await setup();
    const preview = await previewSuggestions();
    const elision = preview.suggestions.find((s) => s.original === 'un altra');
    if (!elision) throw new Error('manca il suggerimento di elisione');

    await screen.findByTestId('editor-text-p0'); // capitolo caricato: bottone attivo
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

  it('le varianti di stile si scelgono a chip: accettare applica quella scelta', async () => {
    const { screen, chapterRepository } = await setup();
    const preview = await previewSuggestions();
    const adverb = preview.suggestions.find((s) => s.original === 'posò lentamente');
    if (!adverb) throw new Error('manca il suggerimento sull’avverbio');
    expect(adverb.proposals).toHaveLength(3);

    await screen.findByTestId('editor-text-p0'); // capitolo caricato: bottone attivo
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));

    await fireEvent.press(await screen.findByTestId(`review-variant-${adverb.id}-1`));
    await fireEvent.press(await screen.findByTestId(`review-accept-${adverb.id}`));
    await waitFor(async () => {
      expect(await chapterRepository.loadRawText(CHAPTER)).toContain('posò, piano, il bicchiere');
    });
    await screen.unmount();
  });

  it('«accetta tutti» della categoria applica tutte le patch grammaticali', async () => {
    const { screen, chapterRepository, revisionRepository } = await setup();

    await screen.findByTestId('editor-text-p0'); // capitolo caricato: bottone attivo
    await fireEvent.press(await screen.findByTestId('editor-refine'));
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));
    await fireEvent.press(await screen.findByTestId('review-filter-grammar'));
    await fireEvent.press(await screen.findByTestId('review-accept-all'));

    await waitFor(async () => {
      const saved = await chapterRepository.loadRawText(CHAPTER);
      expect(saved).toContain("un'altra tazza");
      expect(saved).toContain('. Aprì il rubinetto');
    });
    const revisions = await revisionRepository.list(CHAPTER);
    expect(revisions.filter((r) => r.decision === 'accepted')).toHaveLength(2);
    // un solo undo li annulla tutti e due (comando composito)
    await fireEvent.press(await screen.findByTestId('review-undo'));
    await waitFor(async () => {
      expect(await chapterRepository.loadRawText(CHAPTER)).toBe(BRANO);
    });
    await screen.unmount();
  });

  it('un edit manuale che tocca uno span invalida il suggerimento (stale)', async () => {
    const { screen } = await setup();
    const preview = await previewSuggestions();
    const elision = preview.suggestions.find((s) => s.original === 'un altra');
    if (!elision) throw new Error('manca il suggerimento di elisione');

    await screen.findByTestId('editor-text-p0'); // capitolo caricato: bottone attivo
    await fireEvent.press(await screen.findByTestId('editor-refine'));

    // l'utente corregge a mano proprio lì: 'un altra' → 'una nuova'
    await fireEvent.press(await screen.findByTestId('editor-edit-toggle'));
    const input = await screen.findByTestId('editor-input');
    await fireEvent.changeText(input, BRANO.replace('un altra', 'una nuova'));
    await fireEvent.press(await screen.findByTestId('editor-edit-toggle'));

    // l'evidenziazione dell'elisione sparisce, le altre restano
    await waitFor(() => {
      expect(screen.queryByTestId(`highlight-${elision.id}`)).toBeNull();
    });
    const adverb = preview.suggestions.find((s) => s.original === 'posò lentamente');
    expect(screen.getByTestId(`highlight-${adverb!.id}`)).toBeOnTheScreen();

    // e in Review compare la nota sui suggerimenti non più applicabili
    await fireEvent.press(await screen.findByTestId('editor-suggestions-chip'));
    expect(await screen.findByTestId('review-stale-note')).toHaveTextContent(
      /non è più applicabile/,
    );
    await screen.unmount();
  });

  it('capitolo vuoto: Rifinisci disabilitato e invito a dettare', async () => {
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
