// Tab Sinossi: sinossi con salvataggio, generazione → anteprima
// corkboard modificabile/eliminabile → conferma = merge additivo.

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
  it('non mostra l’avviso della chiave di sviluppo con il provider predefinito', async () => {
    const { result } = setup();
    const screen = await result;
    await screen.findByTestId('synopsis-tab');
    expect(screen.queryByTestId('synopsis-freekey-warning')).toBeNull();
    await screen.unmount();
  });

  it('mostra la sinossi del libro e la salva modificata', async () => {
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

  it('genera la scaletta e mostra l’anteprima a schede (titolo e beat)', async () => {
    const { result, outlineService } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));

    const card = await screen.findByTestId('outline-card-0');
    expect(card).toHaveTextContent(/La secca/);
    expect(card).toHaveTextContent(/beat 1a/);
    expect(screen.getByTestId('outline-card-1')).toHaveTextContent(/Il patto/);
    // la sinossi inviata è quella del campo, con requestId da idempotenza
    expect(outlineService.requests[0]).toMatchObject({
      bookId: 'faro',
      synopsis: 'Una custode di faro e un patto antico.',
    });
    expect(outlineService.requests[0]?.requestId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    await screen.unmount();
  });

  it('le schede si possono eliminare e modificare prima della conferma', async () => {
    const { result } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await screen.findByTestId('outline-card-0');

    // elimina la seconda scheda
    await fireEvent.press(screen.getByTestId('outline-card-delete-1'));
    expect(screen.queryByTestId('outline-card-1')).toBeNull();

    // modifica la prima: titolo e beat (uno per riga, righe vuote scartate)
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

  it('conferma su libro senza capitoli: crea tutti i capitoli draft con outline', async () => {
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
    // l'anteprima si chiude e l'esito è visibile
    expect(screen.queryByTestId('outline-card-0')).toBeNull();
    expect(await screen.findByTestId('synopsis-status')).toHaveTextContent(/2 capitoli nuovi/);
    await screen.unmount();
  });

  it('merge additivo: il capitolo scritto resta intatto, lo slot vuoto si riempie, il resto va in coda', async () => {
    const { result, chapters } = setup({ seedChapters: true });
    const screen = await result;

    expect(await screen.findByTestId('synopsis-merge-note')).toHaveTextContent(/intoccat/);

    await fireEvent.press(screen.getByTestId('synopsis-generate'));
    await fireEvent.press(await screen.findByTestId('outline-confirm'));

    await waitFor(async () => {
      const all = await chaptersOf(chapters);
      expect(all).toHaveLength(3);
      // il capitolo con testo NON è stato toccato
      expect(all[0]).toMatchObject({
        title: 'Il ritorno',
        rawText: 'Testo già dettato.',
        outline: null,
      });
      // lo slot vuoto ha preso titolo e outline della prima scheda
      expect(all[1]).toMatchObject({
        title: 'La secca',
        rawText: '',
        outline: { summary: 'Riassunto uno.', beats: ['beat 1a', 'beat 1b'] },
      });
      // la seconda scheda è un capitolo nuovo in coda
      expect(all[2]).toMatchObject({ title: 'Il patto', status: 'draft' });
    });
    expect(await screen.findByTestId('synopsis-status')).toHaveTextContent(
      /1 capitolo vuoto riempito, 1 capitolo nuovo/,
    );
    await screen.unmount();
  });

  it('un errore della callable diventa un messaggio leggibile', async () => {
    const { result, outlineService } = setup();
    outlineService.nextError = new Error('Il modello non ha prodotto una scaletta valida.');
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    expect(await screen.findByTestId('synopsis-status')).toHaveTextContent(/scaletta valida/);
    // niente anteprima su errore
    expect(screen.queryByTestId('outline-card-0')).toBeNull();
    await screen.unmount();
  });
});
