import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import {
  InMemoryBookExportService,
  InMemoryExportFileSink,
  InMemoryPendingSuggestionsRepository,
} from '../../export';
import { InMemoryOutlineService } from '../../outline';
import { BookScreen } from '../BookScreen';
import { InMemoryBookRepository } from '../InMemoryBookRepository';

function seedChapters(chapters: InMemoryChapterRepository) {
  chapters.seed({ bookId: 'faro', chapterId: 'c1' }, 'testo uno', {
    title: 'Le chiavi di casa',
    order: 0,
    status: 'final',
    wordCount: 3180,
  });
  chapters.seed({ bookId: 'faro', chapterId: 'c2' }, 'testo due', {
    title: 'La bassa marea',
    order: 1,
    status: 'refined',
    wordCount: 2940,
  });
  chapters.seed({ bookId: 'faro', chapterId: 'c3' }, 'testo tre', {
    title: 'La marea',
    order: 2,
    status: 'draft',
    wordCount: 1248,
  });
}

function renderBook(overrides?: {
  onOpenChapter?: jest.Mock;
  onDictateChapter?: jest.Mock;
  onOpenNotes?: jest.Mock;
}) {
  const books = new InMemoryBookRepository();
  books.seed({ id: 'faro', title: 'Il custode del faro', wordCount: 24_310, chapterCount: 9 });
  const chapters = new InMemoryChapterRepository();
  seedChapters(chapters);
  const onBack = jest.fn();
  const onOpenChapter = overrides?.onOpenChapter ?? jest.fn();
  const onDictateChapter = overrides?.onDictateChapter ?? jest.fn();
  const onOpenNotes = overrides?.onOpenNotes ?? jest.fn();
  const result = render(
    <ThemeProvider>
      <BookScreen
        bookId="faro"
        bookRepository={books}
        chapterRepository={chapters}
        exportService={new InMemoryBookExportService()}
        pendingSuggestions={new InMemoryPendingSuggestionsRepository()}
        exportFileSink={new InMemoryExportFileSink()}
        outlineService={new InMemoryOutlineService()}
        onBack={onBack}
        onOpenChapter={onOpenChapter}
        onDictateChapter={onDictateChapter}
        onOpenNotes={onOpenNotes}
      />
    </ThemeProvider>,
  );
  return { result, books, chapters, onBack, onOpenChapter, onDictateChapter, onOpenNotes };
}

describe('BookScreen', () => {
  it('mostra intestazione, numerali romani e stati a colore dei capitoli', async () => {
    const { result, books } = renderBook();
    const screen = await result;

    expect(await screen.findByText('Il custode del faro')).toBeOnTheScreen();
    expect(screen.getByText(/24\.310 parole · 9 capitoli/)).toBeOnTheScreen();
    // nota: it-IT non raggruppa i numeri a 4 cifre (CLDR), quindi "3180"
    expect(screen.getByTestId('book-chapter-c1')).toHaveTextContent(/Finale · 3180 parole/);
    expect(screen.getByTestId('book-chapter-c2')).toHaveTextContent(/Rifinito/);
    expect(screen.getByTestId('book-chapter-c3')).toHaveTextContent(/Bozza/);
    // numerali romani in ordine di lista
    expect(screen.getByTestId('book-chapter-c2')).toHaveTextContent(/^II/);
    // all'apertura parte la riconciliazione self-healing dei contatori
    expect(books.reconcileCalls).toContain('faro');
    await screen.unmount();
  });

  it('tap sulla riga apre l’editor, il mic apre la dettatura (posizione 1-based)', async () => {
    const onOpenChapter = jest.fn();
    const onDictateChapter = jest.fn();
    const { result } = renderBook({ onOpenChapter, onDictateChapter });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('book-chapter-c2'));
    expect(onOpenChapter).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }), 2);
    await fireEvent.press(screen.getByTestId('book-chapter-mic-c3'));
    expect(onDictateChapter).toHaveBeenCalledWith(expect.objectContaining({ id: 'c3' }), 3);
    await screen.unmount();
  });

  it('press lungo attiva il riordino e le frecce spostano i capitoli', async () => {
    const { result, chapters } = renderBook();
    const screen = await result;

    await fireEvent(await screen.findByTestId('book-chapter-c1'), 'onLongPress');
    await fireEvent.press(await screen.findByTestId('book-chapter-down-c1'));

    await waitFor(async () => {
      const list = await chapters.getChapter({ bookId: 'faro', chapterId: 'c1' });
      expect(list?.order).toBe(1);
    });
    // in modalità riordino il tap sulla riga non apre l'editor
    expect(screen.getByTestId('book-reorder-done')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('book-reorder-done'));
    expect(screen.queryByTestId('book-reorder-done')).toBeNull();
    await screen.unmount();
  });

  it('crea un capitolo dal titolo digitato', async () => {
    const { result, chapters } = renderBook();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('book-new-chapter'));
    await fireEvent.changeText(
      await screen.findByTestId('book-new-chapter-title'),
      'Il registro delle tempeste',
    );
    await fireEvent.press(screen.getByTestId('book-new-chapter-create'));

    await waitFor(async () => {
      const created = await chapters.getChapter({ bookId: 'faro', chapterId: 'capitolo-1' });
      expect(created).toMatchObject({ title: 'Il registro delle tempeste', order: 3 });
    });
    await screen.unmount();
  });

  it('l’azione nell’header apre il Taccuino passando il titolo del libro', async () => {
    const onOpenNotes = jest.fn();
    const { result } = renderBook({ onOpenNotes });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('book-open-notes'));
    expect(onOpenNotes).toHaveBeenCalledWith('Il custode del faro');
    await screen.unmount();
  });

  it('la tab Sinossi mostra la feature vera, la tab Export la sua', async () => {
    const { result } = renderBook();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('book-tab-synopsis'));
    expect(await screen.findByTestId('synopsis-tab')).toBeOnTheScreen();
    expect(screen.getByTestId('synopsis-generate')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('book-tab-export'));
    expect(await screen.findByTestId('export-tab')).toBeOnTheScreen();
    expect(screen.getByText('Metadati KDP')).toBeOnTheScreen();
    await screen.unmount();
  });
});
