import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import { DEFAULT_SETTINGS } from '../../settings';
import type { SettingsRepository } from '../../settings';
import { InMemoryBookRepository } from '../InMemoryBookRepository';
import { LibraryScreen } from '../LibraryScreen';
import type { DailyProgressRepository } from '../dailyProgress';

function fakeSettings(dailyGoalWords: number): SettingsRepository {
  return {
    load: async () => ({ ...DEFAULT_SETTINGS, dailyGoalWords }),
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
  it('mostra obiettivo del giorno e libri con i contatori denormalizzati', async () => {
    const books = new InMemoryBookRepository();
    books.seed({
      id: 'faro',
      title: 'Il custode del faro',
      wordCount: 24_310,
      chapterCount: 9,
      genre: 'Romanzo',
    });
    books.seed({
      id: 'molo',
      title: 'Racconti del molo',
      wordCount: 6_120,
      chapterCount: 3,
      genre: 'Raccolta',
    });
    const { result } = renderLibrary({ books });
    const screen = await result;

    expect(await screen.findByTestId('library-goal')).toHaveTextContent(/512 \/ 800 parole/);
    expect(screen.getByTestId('library-book-faro')).toHaveTextContent(/9 capitoli/);
    expect(screen.getByTestId('library-book-faro')).toHaveTextContent(/24\.310 parole/);
    expect(screen.getByTestId('library-book-molo')).toHaveTextContent(/Raccolta/);
    expect(screen.getByText('2 in corso')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('senza libri invita a crearne uno', async () => {
    const { result } = renderLibrary();
    const screen = await result;
    expect(await screen.findByText('Nessun libro, per ora')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('il FAB crea un libro dal titolo digitato e lo apre', async () => {
    const onOpenBook = jest.fn();
    const { result, books } = renderLibrary({ onOpenBook });
    const screen = await result;

    await fireEvent.press(screen.getByTestId('library-fab'));
    await fireEvent.changeText(
      await screen.findByTestId('library-new-book-title'),
      '  Il custode del faro  ',
    );
    await fireEvent.press(screen.getByTestId('library-new-book-create'));

    const created = await screen.findByTestId('library-book-libro-1');
    expect(created).toHaveTextContent(/Il custode del faro/);
    expect(onOpenBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Il custode del faro' }),
    );
    expect(await books.getBook('libro-1')).toMatchObject({ wordCount: 0, chapterCount: 0 });
    await screen.unmount();
  });

  it('il tap su una card apre il libro e l’ingranaggio apre le Impostazioni', async () => {
    const books = new InMemoryBookRepository();
    books.seed({ id: 'faro', title: 'Il custode del faro' });
    const onOpenBook = jest.fn();
    const onOpenSettings = jest.fn();
    const { result } = renderLibrary({ books, onOpenBook, onOpenSettings });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('library-book-faro'));
    expect(onOpenBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'faro' }));
    await fireEvent.press(screen.getByTestId('library-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
    await screen.unmount();
  });

  it('il tap sulla card "Obiettivo di oggi" apre il diario dei progressi', async () => {
    const onOpenProgress = jest.fn();
    const { result } = renderLibrary({ onOpenProgress });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('library-goal-open'));
    expect(onOpenProgress).toHaveBeenCalled();
    await screen.unmount();
  });
});
