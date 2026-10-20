import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import App, { type AppServices } from '../App';
import { InMemoryBookRepository, LocalDailyProgressRepository } from '../src/features/books';
import { InMemoryChapterRepository } from '../src/features/chapters';
import {
  InMemoryBookExportService,
  InMemoryExportFileSink,
  InMemoryPendingSuggestionsRepository,
} from '../src/features/export';
import { InMemoryNoteRepository } from '../src/features/notes';
import { InMemoryRevisionRepository, FakeSuggestionsProvider } from '../src/features/review';
import { InMemoryOutlineService } from '../src/features/outline';
import { InMemoryBackupService, LocalSettingsRepository } from '../src/features/settings';
import { DEFAULT_SETTINGS } from '../src/features/settings/types';
import { paperPalette } from '../src/theme';

// Google fonts do not load in the jest environment: loading is simulated as
// completed so the real app tree can be tested.
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
}));

// Native modules (speech recognition, haptics, keep-awake, network,
// AsyncStorage) are covered by the automatic mocks in app/__mocks__.

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function testServices(): AppServices & { books: InMemoryBookRepository } {
  const books = new InMemoryBookRepository();
  books.seed({ id: 'mulino', title: 'Le arnie del mulino', chapterCount: 1 });
  const chapters = new InMemoryChapterRepository();
  chapters.seed({ bookId: 'mulino', chapterId: 'c1' }, 'Il mulino era fermo.', {
    title: 'Le chiavi di casa',
    order: 0,
  });
  return {
    books,
    bookRepository: books,
    chapterRepository: chapters,
    noteRepository: new InMemoryNoteRepository(),
    settingsRepository: new LocalSettingsRepository(memoryStorage()),
    dailyProgressRepository: new LocalDailyProgressRepository(memoryStorage()),
    revisionRepository: new InMemoryRevisionRepository(),
    suggestionsProvider: new FakeSuggestionsProvider(),
    exportService: new InMemoryBookExportService(),
    pendingSuggestions: new InMemoryPendingSuggestionsRepository(),
    exportFileSink: new InMemoryExportFileSink(),
    backupService: new InMemoryBackupService(),
    outlineService: new InMemoryOutlineService(),
  };
}

describe('App', () => {
  it('after sign-in opens the Library and navigates to Dictation and back', async () => {
    const services = testServices();
    const screen = await render(
      <App signIn={async () => 'utente-di-prova'} createServices={() => services} />,
    );
    await act(async () => {}); // sign-in + caricamenti iniziali

    // Library
    expect(await screen.findByTestId('library-screen')).toBeOnTheScreen();
    expect(await screen.findByTestId('library-book-mulino')).toHaveTextContent(
      /Le arnie del mulino/,
    );
    // the rose window sits behind the Library (and only there: not in the editor)
    expect(screen.getByTestId('cathedral-rose')).toBeOnTheScreen();

    // Library → Book
    await fireEvent.press(screen.getByTestId('library-book-mulino'));
    expect(await screen.findByTestId('book-screen')).toBeOnTheScreen();
    expect(await screen.findByTestId('book-chapter-c1')).toHaveTextContent(/Le chiavi di casa/);

    // Book → Dictation on the REAL chapter via the shared repository
    await fireEvent.press(screen.getByTestId('book-chapter-mic-c1'));
    expect(await screen.findByTestId('dictation-screen')).toBeOnTheScreen();
    await act(async () => {}); // caricamento capitolo + pre-flight
    expect(screen.getByText(/CAPITOLO I · LE CHIAVI DI CASA/)).toBeOnTheScreen();
    expect(screen.getByText(/Il mulino era fermo\./)).toBeOnTheScreen();

    // Dictation → back to the Book
    await fireEvent.press(screen.getByTestId('dictation-back'));
    expect(await screen.findByTestId('book-screen')).toBeOnTheScreen();

    // Book → Notebook from the header action, with the book's eyebrow
    await fireEvent.press(screen.getByTestId('book-open-notes'));
    expect(await screen.findByTestId('notes-screen')).toBeOnTheScreen();
    expect(screen.getByText('Le arnie del mulino')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('notes-back'));
    expect(await screen.findByTestId('book-screen')).toBeOnTheScreen();

    // Book → Editor on the same chapter
    await fireEvent.press(screen.getByTestId('book-chapter-c1'));
    expect(await screen.findByTestId('editor-screen')).toBeOnTheScreen();
    await act(async () => {});
    expect(screen.getByText(/Il mulino era fermo\./)).toBeOnTheScreen();

    await screen.unmount();
  });

  it('the Library gear opens Settings and goes back', async () => {
    const services = testServices();
    const screen = await render(
      <App signIn={async () => 'utente-di-prova'} createServices={() => services} />,
    );
    await act(async () => {});

    await fireEvent.press(await screen.findByTestId('library-settings'));
    expect(await screen.findByTestId('settings-screen')).toBeOnTheScreen();
    await act(async () => {});
    await fireEvent.press(await screen.findByTestId('settings-back'));
    expect(await screen.findByTestId('library-screen')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('if sign-in fails shows the error instead of an empty Library', async () => {
    const screen = await render(
      <App
        signIn={async () => {
          throw new Error('emulator down');
        }}
        createServices={() => testServices()}
      />,
    );
    await act(async () => {});
    expect(await screen.findByTestId('auth-error')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('dictation listens in the language of the BOOK, whatever the interface language', async () => {
    const services = testServices();
    services.books.seed({ id: 'dark', title: 'The Dark Light', chapterCount: 1, language: 'en' });
    (services.chapterRepository as InMemoryChapterRepository).seed(
      { bookId: 'dark', chapterId: 'c1' },
      '',
      { title: 'The stairs', order: 0 },
    );
    const screen = await render(
      <App signIn={async () => 'utente-di-prova'} createServices={() => services} />,
    );
    await act(async () => {});
    await fireEvent.press(await screen.findByTestId('library-book-dark'));
    await fireEvent.press(await screen.findByTestId('book-chapter-mic-c1'));
    expect(await screen.findByTestId('dictation-screen')).toBeOnTheScreen();
    await act(async () => {});
    expect(screen.getByText('«period»')).toBeOnTheScreen();
    expect(screen.queryByText('«punto»')).toBeNull();
  });

  it('applies the saved theme at launch, not only when Settings is opened', async () => {
    const services = testServices();
    await services.settingsRepository.save({
      ...DEFAULT_SETTINGS,
      theme: 'paper',
      themeChosen: true,
    });
    const screen = await render(
      <App signIn={async () => 'utente-di-prova'} createServices={() => services} />,
    );
    await act(async () => {});
    const library = await screen.findByTestId('library-screen');
    await waitFor(() => expect(library).toHaveStyle({ backgroundColor: paperPalette.background }));
  });

  it('while the app opens, the startup screen is shown, not a blank one', async () => {
    const screen = await render(
      <App signIn={() => new Promise<string>(() => {})} createServices={() => testServices()} />,
    );
    await act(async () => {});
    expect(await screen.findByTestId('startup-screen')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('if opening fails the Retry button tries again and the Library opens', async () => {
    const signIn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('utente-di-prova');
    const screen = await render(<App signIn={signIn} createServices={() => testServices()} />);
    await act(async () => {});
    await fireEvent.press(await screen.findByTestId('startup-retry'));
    expect(await screen.findByTestId('library-screen')).toBeOnTheScreen();
    expect(signIn).toHaveBeenCalledTimes(2);
    await screen.unmount();
  });
});
