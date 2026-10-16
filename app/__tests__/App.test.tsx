import { act, fireEvent, render } from '@testing-library/react-native';

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

// I font Google non si caricano in ambiente jest: si simula il caricamento
// completato per testare l'albero vero dell'app.
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
}));

// I moduli nativi (speech recognition, haptics, keep-awake, network,
// AsyncStorage) sono coperti dai mock automatici in app/__mocks__.

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
  books.seed({ id: 'faro', title: 'Il custode del faro', chapterCount: 1 });
  const chapters = new InMemoryChapterRepository();
  chapters.seed({ bookId: 'faro', chapterId: 'c1' }, 'Il faro era spento.', {
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
  it('dopo il sign-in apre la Libreria e naviga fino alla Dettatura e ritorno', async () => {
    const services = testServices();
    const screen = await render(
      <App signIn={async () => 'utente-di-prova'} createServices={() => services} />,
    );
    await act(async () => {}); // sign-in + caricamenti iniziali

    // Libreria
    expect(await screen.findByTestId('library-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('library-book-faro')).toHaveTextContent(/Il custode del faro/);

    // Libreria → Libro
    await fireEvent.press(screen.getByTestId('library-book-faro'));
    expect(await screen.findByTestId('book-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('book-chapter-c1')).toHaveTextContent(/Le chiavi di casa/);

    // Libro → Dettatura sul capitolo VERO via repository condiviso
    await fireEvent.press(screen.getByTestId('book-chapter-mic-c1'));
    expect(await screen.findByTestId('dictation-screen')).toBeOnTheScreen();
    await act(async () => {}); // caricamento capitolo + pre-flight
    expect(screen.getByText(/CAPITOLO I · LE CHIAVI DI CASA/)).toBeOnTheScreen();
    expect(screen.getByText(/Il faro era spento\./)).toBeOnTheScreen();

    // Dettatura → indietro al Libro
    await fireEvent.press(screen.getByTestId('dictation-back'));
    expect(await screen.findByTestId('book-screen')).toBeOnTheScreen();

    // Libro → Taccuino dall'azione nell'header, con l'eyebrow del libro
    await fireEvent.press(screen.getByTestId('book-open-notes'));
    expect(await screen.findByTestId('notes-screen')).toBeOnTheScreen();
    expect(screen.getByText('Il custode del faro')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('notes-back'));
    expect(await screen.findByTestId('book-screen')).toBeOnTheScreen();

    // Libro → Editor sullo stesso capitolo
    await fireEvent.press(screen.getByTestId('book-chapter-c1'));
    expect(await screen.findByTestId('editor-screen')).toBeOnTheScreen();
    await act(async () => {});
    expect(screen.getByText(/Il faro era spento\./)).toBeOnTheScreen();

    await screen.unmount();
  });

  it('l’ingranaggio della Libreria apre le Impostazioni e torna indietro', async () => {
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

  it('se il sign-in fallisce mostra l’errore invece di una Libreria vuota', async () => {
    const screen = await render(
      <App
        signIn={async () => {
          throw new Error('emulatore spento');
        }}
        createServices={() => testServices()}
      />,
    );
    await act(async () => {});
    expect(await screen.findByTestId('auth-error')).toBeOnTheScreen();
    await screen.unmount();
  });
});
