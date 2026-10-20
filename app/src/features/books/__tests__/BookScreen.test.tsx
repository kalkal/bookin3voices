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
  chapters.seed({ bookId: 'mulino', chapterId: 'c1' }, 'testo uno', {
    title: 'Le chiavi di casa',
    order: 0,
    status: 'final',
    wordCount: 3180,
  });
  chapters.seed({ bookId: 'mulino', chapterId: 'c2' }, 'testo due', {
    title: 'La piena del fiume',
    order: 1,
    status: 'refined',
    wordCount: 2940,
  });
  chapters.seed({ bookId: 'mulino', chapterId: 'c3' }, 'testo tre', {
    title: 'La piena',
    order: 2,
    status: 'draft',
    wordCount: 1248,
  });
}

function renderBook(overrides?: {
  onOpenChapter?: jest.Mock;
  onDictateChapter?: jest.Mock;
  onOpenNotes?: jest.Mock;
  /** A book with no chapters yet. */
  empty?: boolean;
}) {
  const books = new InMemoryBookRepository();
  books.seed({ id: 'mulino', title: 'Le arnie del mulino', wordCount: 24_310, chapterCount: 9 });
  const chapters = new InMemoryChapterRepository();
  if (overrides?.empty !== true) seedChapters(chapters);
  const onBack = jest.fn();
  const onOpenChapter = overrides?.onOpenChapter ?? jest.fn();
  const onDictateChapter = overrides?.onDictateChapter ?? jest.fn();
  const onOpenNotes = overrides?.onOpenNotes ?? jest.fn();
  const result = render(
    <ThemeProvider>
      <BookScreen
        bookId="mulino"
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
  it('the arches stand behind a book with no chapters yet, not behind one with chapters', async () => {
    const vuoto = await renderBook({ empty: true }).result;
    expect(await vuoto.findByTestId('book-new-chapter')).toBeOnTheScreen();
    expect(vuoto.getByTestId('cathedral-arches')).toBeOnTheScreen();
    await vuoto.unmount();
    const pieno = await renderBook().result;
    expect(await pieno.findByText('La piena')).toBeOnTheScreen();
    expect(pieno.queryByTestId('cathedral-arches')).toBeNull();
  });

  it('shows header, Roman numerals and color-coded chapter statuses', async () => {
    const { result, books } = renderBook();
    const screen = await result;

    expect(await screen.findByText('Le arnie del mulino')).toBeOnTheScreen();
    expect(screen.getByText(/24\.310 parole · 9 capitoli/)).toBeOnTheScreen();
    // chapters arrive after the book: wait for them, do not assume they are loaded
    // note: it-IT does not group 4-digit numbers (CLDR), so "3180"
    expect(await screen.findByTestId('book-chapter-c1')).toHaveTextContent(/Finale · 3180 parole/);
    expect(screen.getByTestId('book-chapter-c2')).toHaveTextContent(/Rifinito/);
    expect(screen.getByTestId('book-chapter-c3')).toHaveTextContent(/Bozza/);
    // Roman numerals in list order
    expect(screen.getByTestId('book-chapter-c2')).toHaveTextContent(/^II/);
    // on open, the self-healing counter reconciliation starts
    expect(books.reconcileCalls).toContain('mulino');
    await screen.unmount();
  });

  it('tapping the row opens the editor, the mic opens dictation (1-based position)', async () => {
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

  it('long press enables reordering and the arrows move the chapters', async () => {
    const { result, chapters } = renderBook();
    const screen = await result;

    await fireEvent(await screen.findByTestId('book-chapter-c1'), 'onLongPress');
    await fireEvent.press(await screen.findByTestId('book-chapter-down-c1'));

    await waitFor(async () => {
      const list = await chapters.getChapter({ bookId: 'mulino', chapterId: 'c1' });
      expect(list?.order).toBe(1);
    });
    // in reorder mode, tapping the row does not open the editor
    expect(screen.getByTestId('book-reorder-done')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('book-reorder-done'));
    expect(screen.queryByTestId('book-reorder-done')).toBeNull();
    await screen.unmount();
  });

  it('creates a chapter from the typed title', async () => {
    const { result, chapters } = renderBook();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('book-new-chapter'));
    await fireEvent.changeText(
      await screen.findByTestId('book-new-chapter-title'),
      'Il registro delle tempeste',
    );
    await fireEvent.press(screen.getByTestId('book-new-chapter-create'));

    await waitFor(async () => {
      const created = await chapters.getChapter({ bookId: 'mulino', chapterId: 'capitolo-1' });
      expect(created).toMatchObject({ title: 'Il registro delle tempeste', order: 3 });
    });
    await screen.unmount();
  });

  it('the header action opens the Notebook, passing the book title', async () => {
    const onOpenNotes = jest.fn();
    const { result } = renderBook({ onOpenNotes });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('book-open-notes'));
    expect(onOpenNotes).toHaveBeenCalledWith('Le arnie del mulino');
    await screen.unmount();
  });

  it('the Synopsis tab shows the real feature, the Export tab shows its own', async () => {
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
