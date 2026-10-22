// Judges build: without the `judge` claim the app runs in offline sample mode
// (banner, in-memory sample book, nothing on the server); a redeemed code
// refreshes the token, switches to the online services and seeds the sample
// book there; with the claim at startup the app is online directly.

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import App, { type AccessModeDeps, type AppServices } from '../App';
import type { SampleBookHooks } from '../src/features/accessCode';
import { InMemoryBookRepository, LocalDailyProgressRepository } from '../src/features/books';
import { InMemoryChapterRepository } from '../src/features/chapters';
import {
  InMemoryBookExportService,
  InMemoryExportFileSink,
  InMemoryPendingSuggestionsRepository,
} from '../src/features/export';
import { InMemoryNoteRepository } from '../src/features/notes';
import { InMemoryOutlineDraftRepository, InMemoryOutlineService } from '../src/features/outline';
import { FakeSuggestionsProvider, InMemoryRevisionRepository } from '../src/features/review';
import type { SuggestionsProvider } from '../src/features/review';
import { InMemoryBackupService, LocalSettingsRepository } from '../src/features/settings';

jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
}));

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

/** The "online" services: a library with the user's own book. */
function onlineServices(): AppServices {
  const books = new InMemoryBookRepository();
  books.seed({ id: 'mio', title: 'Il mio libro', chapterCount: 0 });
  return {
    bookRepository: books,
    chapterRepository: new InMemoryChapterRepository(),
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
    outlineDrafts: new InMemoryOutlineDraftRepository(),
  };
}

function sampleHooks() {
  const hooks = {
    createOfflineRepositories: jest.fn(() => {
      const books = new InMemoryBookRepository();
      books.seed({ id: 'sample', title: 'Il libro di esempio', chapterCount: 0 });
      return {
        bookRepository: books,
        chapterRepository: new InMemoryChapterRepository(),
        noteRepository: new InMemoryNoteRepository(),
        suggestionsProvider: new FakeSuggestionsProvider(),
      };
    }),
    seedOnline: jest.fn(async () => 'created'),
    wrapOnlineProvider: jest.fn((inner: SuggestionsProvider) => inner),
  } satisfies SampleBookHooks<AppServices>;
  return hooks;
}

function accessMode(judge: boolean | Error) {
  const sampleBook = sampleHooks();
  const deps = {
    hasJudgeClaim: jest.fn(async () => {
      if (judge instanceof Error) throw judge;
      return judge;
    }),
    refreshIdToken: jest.fn(async () => {}),
    accessCodeService: { redeem: jest.fn(async () => {}) },
    sampleBook,
  } satisfies AccessModeDeps;
  return deps;
}

async function start(deps: AccessModeDeps) {
  const createServices = jest.fn(() => onlineServices());
  await render(
    <App signIn={async () => 'giudice-1'} createServices={createServices} accessMode={deps} />,
  );
  await act(async () => {});
  return { createServices };
}

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('App in the judges build', () => {
  it('no claim at startup: offline sample mode with the banner, nothing online', async () => {
    const deps = accessMode(false);
    const { createServices } = await start(deps);
    expect(await screen.findByTestId('library-book-sample')).toBeOnTheScreen();
    expect(screen.getByTestId('sample-mode-banner')).toHaveTextContent(
      /Modalità esempio — inserisci il codice d’accesso/,
    );
    expect(screen.queryByTestId('library-book-mio')).toBeNull();
    expect(createServices).not.toHaveBeenCalled();
    expect(deps.sampleBook.createOfflineRepositories).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('access-code-modal')).toBeNull();
  });

  it('an unreadable token also means offline sample mode', async () => {
    const deps = accessMode(new Error('network'));
    const { createServices } = await start(deps);
    expect(await screen.findByTestId('sample-mode-banner')).toBeOnTheScreen();
    expect(createServices).not.toHaveBeenCalled();
  });

  it('Enter code → redeem → token refresh → online services, sample book seeded', async () => {
    const deps = accessMode(false);
    const { createServices } = await start(deps);
    await fireEvent.press(await screen.findByTestId('sample-mode-enter-code'));
    await fireEvent.changeText(screen.getByTestId('access-code-input'), 'GIURIA-26');
    await fireEvent.press(screen.getByTestId('access-code-confirm'));
    await act(async () => {});

    expect(deps.accessCodeService.redeem).toHaveBeenCalledWith('GIURIA-26');
    expect(deps.refreshIdToken).toHaveBeenCalledTimes(1);
    expect(deps.accessCodeService.redeem.mock.invocationCallOrder[0]).toBeLessThan(
      deps.refreshIdToken.mock.invocationCallOrder[0] ?? 0,
    );
    expect(await screen.findByTestId('library-book-mio')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-book-sample')).toBeNull();
    expect(screen.queryByTestId('sample-mode-banner')).toBeNull();
    expect(screen.queryByTestId('access-code-modal')).toBeNull();
    expect(createServices).toHaveBeenCalledWith('giudice-1');
    expect(deps.sampleBook.seedOnline).toHaveBeenCalledTimes(1);
    const [seededServices, seededUid] = deps.sampleBook.seedOnline.mock.calls[0] as unknown as [
      AppServices,
      string,
    ];
    expect(seededUid).toBe('giudice-1');
    expect(seededServices.bookRepository).toBe(
      createServices.mock.results[0]?.value.bookRepository,
    );
  });

  it('a failed token refresh keeps the prompt open and the app offline', async () => {
    const deps = accessMode(false);
    deps.refreshIdToken.mockRejectedValueOnce(new Error('network'));
    const { createServices } = await start(deps);
    await fireEvent.press(await screen.findByTestId('sample-mode-enter-code'));
    await fireEvent.changeText(screen.getByTestId('access-code-input'), 'GIURIA-26');
    await fireEvent.press(screen.getByTestId('access-code-confirm'));
    expect(screen.getByTestId('access-code-error')).toHaveTextContent(/connessione/);
    expect(screen.getByTestId('sample-mode-banner')).toBeOnTheScreen();
    expect(createServices).not.toHaveBeenCalled();
  });

  it('claim present at startup: online directly, no banner, no seeding', async () => {
    const deps = accessMode(true);
    const { createServices } = await start(deps);
    expect(await screen.findByTestId('library-book-mio')).toBeOnTheScreen();
    expect(screen.queryByTestId('sample-mode-banner')).toBeNull();
    expect(createServices).toHaveBeenCalledTimes(1);
    expect(deps.sampleBook.createOfflineRepositories).not.toHaveBeenCalled();
    expect(deps.sampleBook.wrapOnlineProvider).toHaveBeenCalledTimes(1);
    expect(deps.sampleBook.seedOnline).not.toHaveBeenCalled();
  });
});
