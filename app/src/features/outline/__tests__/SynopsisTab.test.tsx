// Synopsis tab: synopsis with save, generation → editable/deletable
// corkboard preview → confirmation = additive merge.

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import { InMemoryBookRepository } from '../../books';
import { InMemoryChapterRepository } from '../../chapters';
import { InMemoryOutlineService } from '../inMemory';
import { SynopsisTab } from '../SynopsisTab';
import type { OutlineCard } from '../types';

const CARDS: OutlineCard[] = [
  { title: 'La secca', summary: 'Riassunto uno.', beats: ['beat 1a', 'beat 1b'] },
  { title: 'Il patto', summary: 'Riassunto due.', beats: ['beat 2a'] },
];

function setup(options?: { cards?: OutlineCard[]; seedChapters?: boolean }) {
  const books = new InMemoryBookRepository();
  const book = books.seed({
    id: 'faro',
    title: 'Il faro di Levante',
    synopsis: 'Una custode di faro e un patto antico.',
  });
  const chapters = new InMemoryChapterRepository();
  if (options?.seedChapters === true) {
    chapters.seed({ bookId: 'faro', chapterId: 'scritto-1' }, 'Testo già dettato.', {
      title: 'Il ritorno',
      order: 0,
    });
    chapters.seed({ bookId: 'faro', chapterId: 'vuoto-1' }, '', {
      title: 'Segnaposto',
      order: 1,
    });
  }
  const outlineService = new InMemoryOutlineService(options?.cards ?? CARDS);
  const result = render(
    <ThemeProvider>
      <SynopsisTab
        book={book}
        bookRepository={books}
        chapterRepository={chapters}
        outlineService={outlineService}
      />
    </ThemeProvider>,
  );
  return { result, books, chapters, outlineService };
}

async function chaptersOf(repo: InMemoryChapterRepository) {
  return new Promise<Awaited<ReturnType<InMemoryChapterRepository['getChapter']>>[]>((resolve) => {
    repo.observeChapters('faro', (summaries) => {
      void Promise.all(
        summaries.map((s) => repo.getChapter({ bookId: 'faro', chapterId: s.id })),
      ).then(resolve);
    });
  });
}

describe('SynopsisTab', () => {
  it('does not show the development-key warning with the default provider', async () => {
    const { result } = setup();
    const screen = await result;
    await screen.findByTestId('synopsis-tab');
    expect(screen.queryByTestId('synopsis-freekey-warning')).toBeNull();
    await screen.unmount();
  });

  it('shows the book synopsis and saves it after editing', async () => {
    const { result, books } = setup();
    const screen = await result;

    expect(await screen.findByTestId('synopsis-input')).toHaveProp(
      'value',
      'Una custode di faro e un patto antico.',
    );
    await fireEvent.changeText(screen.getByTestId('synopsis-input'), 'Trama di prova nuova.');
    await fireEvent.press(screen.getByTestId('synopsis-save'));

    await waitFor(async () => {
      const saved = await books.getBook('faro');
      expect(saved?.synopsis).toBe('Trama di prova nuova.');
    });
    expect(await screen.findByTestId('synopsis-saved')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('generates the outline and shows the card preview (title and beats)', async () => {
    const { result, outlineService } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));

    const card = await screen.findByTestId('outline-card-0');
    expect(card).toHaveTextContent(/La secca/);
    expect(card).toHaveTextContent(/beat 1a/);
    expect(screen.getByTestId('outline-card-1')).toHaveTextContent(/Il patto/);
    // the synopsis sent is the field's one, with an idempotency requestId
    expect(outlineService.requests[0]).toMatchObject({
      bookId: 'faro',
      synopsis: 'Una custode di faro e un patto antico.',
    });
    expect(outlineService.requests[0]?.requestId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    await screen.unmount();
  });

  it('cards can be deleted and edited before confirmation', async () => {
    const { result } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await screen.findByTestId('outline-card-0');

    // delete the second card
    await fireEvent.press(screen.getByTestId('outline-card-delete-1'));
    expect(screen.queryByTestId('outline-card-1')).toBeNull();

    // edit the first: title and beats (one per line, empty lines discarded)
    await fireEvent.press(screen.getByTestId('outline-card-edit-0'));
    await fireEvent.changeText(screen.getByTestId('outline-edit-title'), 'La secca, rivista');
    await fireEvent.changeText(
      screen.getByTestId('outline-edit-beats'),
      'beat nuovo 1\n\n  beat nuovo 2  ',
    );
    await fireEvent.press(screen.getByTestId('outline-edit-save'));

    const card = await screen.findByTestId('outline-card-0');
    expect(card).toHaveTextContent(/La secca, rivista/);
    expect(card).toHaveTextContent(/beat nuovo 1/);
    expect(card).toHaveTextContent(/beat nuovo 2/);
    await screen.unmount();
  });

  it('confirmation on a book without chapters: creates all draft chapters with outline', async () => {
    const { result, chapters } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await fireEvent.press(await screen.findByTestId('outline-confirm'));

    await waitFor(async () => {
      const all = await chaptersOf(chapters);
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({
        title: 'La secca',
        status: 'draft',
        rawText: '',
        outline: { summary: 'Riassunto uno.', beats: ['beat 1a', 'beat 1b'] },
      });
      expect(all[1]).toMatchObject({ title: 'Il patto', status: 'draft' });
    });
    // the preview closes and the outcome is visible
    expect(screen.queryByTestId('outline-card-0')).toBeNull();
    expect(await screen.findByTestId('synopsis-status')).toHaveTextContent(/2 capitoli nuovi/);
    await screen.unmount();
  });

  it('additive merge: the written chapter stays intact, the empty slot is filled, the rest goes at the end', async () => {
    const { result, chapters } = setup({ seedChapters: true });
    const screen = await result;

    expect(await screen.findByTestId('synopsis-merge-note')).toHaveTextContent(/intoccat/);

    await fireEvent.press(screen.getByTestId('synopsis-generate'));
    await fireEvent.press(await screen.findByTestId('outline-confirm'));

    await waitFor(async () => {
      const all = await chaptersOf(chapters);
      expect(all).toHaveLength(3);
      // the chapter with text was NOT touched
      expect(all[0]).toMatchObject({
        title: 'Il ritorno',
        rawText: 'Testo già dettato.',
        outline: null,
      });
      // the empty slot took the title and outline of the first card
      expect(all[1]).toMatchObject({
        title: 'La secca',
        rawText: '',
        outline: { summary: 'Riassunto uno.', beats: ['beat 1a', 'beat 1b'] },
      });
      // the second card is a new chapter at the end
      expect(all[2]).toMatchObject({ title: 'Il patto', status: 'draft' });
    });
    expect(await screen.findByTestId('synopsis-status')).toHaveTextContent(
      /1 capitolo vuoto riempito, 1 capitolo nuovo/,
    );
    await screen.unmount();
  });

  it('a callable error becomes a readable message', async () => {
    const { result, outlineService } = setup();
    outlineService.nextError = new Error('Il modello non ha prodotto una scaletta valida.');
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    expect(await screen.findByTestId('synopsis-status')).toHaveTextContent(/scaletta valida/);
    // no preview on error
    expect(screen.queryByTestId('outline-card-0')).toBeNull();
    await screen.unmount();
  });
});
