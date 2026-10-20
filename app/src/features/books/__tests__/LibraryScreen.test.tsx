import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider } from '../../../theme';
import { DEFAULT_SETTINGS } from '../../settings';
import type { SettingsRepository } from '../../settings';
import { InMemoryBookRepository } from '../InMemoryBookRepository';
import { LibraryScreen } from '../LibraryScreen';
import type { DailyProgressRepository } from '../dailyProgress';

function fakeSettings(dailyGoalWords: number, authorName?: string): SettingsRepository {
  return {
    load: async () => ({ ...DEFAULT_SETTINGS, dailyGoalWords, authorName }),
    save: async () => {},
  };
}

function fakeProgress(words: number): DailyProgressRepository {
  return {
    getToday: async () => ({ date: '2026-09-05', words }),
    addWords: async () => {},
    getHistory: async (nDays: number) =>
      Array.from({ length: nDays }, (_, i) => ({
        date: `2026-09-${String(i + 1).padStart(2, '0')}`,
        words: 0,
      })),
    getStreak: async () => 0,
  };
}

function renderLibrary(overrides?: {
  books?: InMemoryBookRepository;
  onOpenBook?: jest.Mock;
  onOpenSettings?: jest.Mock;
  onOpenProgress?: jest.Mock;
}) {
  const books = overrides?.books ?? new InMemoryBookRepository();
  const onOpenBook = overrides?.onOpenBook ?? jest.fn();
  const onOpenSettings = overrides?.onOpenSettings ?? jest.fn();
  const onOpenProgress = overrides?.onOpenProgress ?? jest.fn();
  const result = render(
    <ThemeProvider>
      <LibraryScreen
        bookRepository={books}
        settingsRepository={fakeSettings(800)}
        dailyProgressRepository={fakeProgress(512)}
        onOpenBook={onOpenBook}
        onOpenSettings={onOpenSettings}
        onOpenProgress={onOpenProgress}
      />
    </ThemeProvider>,
  );
  return { result, books, onOpenBook, onOpenSettings, onOpenProgress };
}

describe('LibraryScreen', () => {
  it('a new book takes the author name from Settings', async () => {
    const books = new InMemoryBookRepository();
    const onOpenBook = jest.fn();
    const screen = await render(
      <ThemeProvider>
        <LibraryScreen
          bookRepository={books}
          settingsRepository={fakeSettings(800, 'Jane Doe')}
          dailyProgressRepository={fakeProgress(0)}
          onOpenBook={onOpenBook}
          onOpenSettings={jest.fn()}
          onOpenProgress={jest.fn()}
        />
      </ThemeProvider>,
    );
    await screen.findByTestId('library-goal');
    await fireEvent.press(screen.getByTestId('library-fab'));
    await fireEvent.changeText(screen.getByTestId('library-new-book-title'), 'Il mulino');
    await fireEvent.press(screen.getByTestId('library-new-book-create'));
    await waitFor(() => expect(onOpenBook).toHaveBeenCalled());
    expect(onOpenBook.mock.calls[0]?.[0]).toMatchObject({ title: 'Il mulino', author: 'Jane Doe' });
    await screen.unmount();
  });

  it('the + button stays above the Android navigation bar, with room to spare', async () => {
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 780 },
          insets: { top: 24, left: 0, right: 0, bottom: 48 },
        }}
      >
        <ThemeProvider>
          <LibraryScreen
            bookRepository={new InMemoryBookRepository()}
            settingsRepository={fakeSettings(800)}
            dailyProgressRepository={fakeProgress(0)}
            onOpenBook={jest.fn()}
            onOpenSettings={jest.fn()}
            onOpenProgress={jest.fn()}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    const fab = StyleSheet.flatten(screen.getByTestId('library-fab').props.style);
    expect(fab.bottom).toBeGreaterThanOrEqual(48 + 16);
    await screen.unmount();
  });

  it('shows the daily goal and books with the denormalized counters', async () => {
    const books = new InMemoryBookRepository();
    books.seed({
      id: 'mulino',
      title: 'Le arnie del mulino',
      wordCount: 24_310,
      chapterCount: 9,
      genre: 'Romanzo',
    });
    books.seed({
      id: 'roggia',
      title: 'Racconti del mulino',
      wordCount: 6_120,
      chapterCount: 3,
      genre: 'Raccolta',
    });
    const { result } = renderLibrary({ books });
    const screen = await result;

    expect(await screen.findByTestId('library-goal')).toHaveTextContent(/512 \/ 800 parole/);
    expect(screen.getByTestId('library-book-mulino')).toHaveTextContent(/9 capitoli/);
    expect(screen.getByTestId('library-book-mulino')).toHaveTextContent(/24\.310 parole/);
    expect(screen.getByTestId('library-book-roggia')).toHaveTextContent(/Raccolta/);
    expect(screen.getByText('2 in corso')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('with no books, prompts to create one', async () => {
    const { result } = renderLibrary();
    const screen = await result;
    expect(await screen.findByText('Nessun libro, per ora')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('the title is the wordmark «book in 3 voices», the same artwork as the README header', async () => {
    const { result } = renderLibrary();
    const screen = await result;
    const wordmark = await screen.findByLabelText('book in 3 voices');
    expect(wordmark).toBeOnTheScreen();
    // one image, tinted with the theme gold: the letters are artwork, not font text
    expect(screen.getByTestId('wordmark-image')).toHaveProp(
      'source',
      require('../../../../assets/brand/wordmark.png'),
    );
    expect(screen.queryByText('voices')).toBeNull();
    expect(screen.queryByText('bookin3voice')).toBeNull();
    await screen.unmount();
  });

  it('the FAB creates a book from the typed title and opens it', async () => {
    const onOpenBook = jest.fn();
    const { result, books } = renderLibrary({ onOpenBook });
    const screen = await result;

    await fireEvent.press(screen.getByTestId('library-fab'));
    await fireEvent.changeText(
      await screen.findByTestId('library-new-book-title'),
      '  Le arnie del mulino  ',
    );
    await fireEvent.press(screen.getByTestId('library-new-book-create'));

    const created = await screen.findByTestId('library-book-libro-1');
    expect(created).toHaveTextContent(/Le arnie del mulino/);
    expect(onOpenBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Le arnie del mulino' }),
    );
    expect(await books.getBook('libro-1')).toMatchObject({ wordCount: 0, chapterCount: 0 });
    await screen.unmount();
  });

  it('tapping a card opens the book and the gear opens Settings', async () => {
    const books = new InMemoryBookRepository();
    books.seed({ id: 'mulino', title: 'Le arnie del mulino' });
    const onOpenBook = jest.fn();
    const onOpenSettings = jest.fn();
    const { result } = renderLibrary({ books, onOpenBook, onOpenSettings });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('library-book-mulino'));
    expect(onOpenBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'mulino' }));
    await fireEvent.press(screen.getByTestId('library-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
    await screen.unmount();
  });

  it('tapping the "Obiettivo di oggi" card opens the progress diary', async () => {
    const onOpenProgress = jest.fn();
    const { result } = renderLibrary({ onOpenProgress });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('library-goal-open'));
    expect(onOpenProgress).toHaveBeenCalled();
    await screen.unmount();
  });
});
