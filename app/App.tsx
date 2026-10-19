/**
 * App root: identity bootstrap (anonymous sign-in, lib/auth), repository
 * construction (Firestore + offline-first mirror) and stack navigation
 * between the app screens:
 * Library → Book → Dictation / Editor+Review, gear icon → Settings.
 * A home-grown stack is enough for these routes; a navigation library can be
 * plugged in here later without touching the screens.
 *
 * Maestro E2E mode (EXPO_PUBLIC_E2E=1): no Firebase — in-memory services,
 * fake sign-in, scripted dictation engine and a stack that starts directly on
 * Dictation ("Capitolo I", as the flow expects).
 */
import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { resolveLanguage, setLanguage, t } from './src/i18n';
import { useLanguage } from './src/i18n/useLanguage';
import { ThemeProvider, candlelightPalette, useAppFonts, useTheme } from './src/theme';
import { createE2EDictationEngine, e2ePreflightChecks, isE2E } from './src/dev/e2eDictation';
import {
  BookScreen,
  FirestoreBookRepository,
  InMemoryBookRepository,
  LibraryScreen,
  LocalDailyProgressRepository,
  ProgressScreen,
} from './src/features/books';
import type { BookRepository, DailyProgressRepository } from './src/features/books';
import {
  FirestoreChapterRepository,
  InMemoryChapterRepository,
  LocalChapterRepository,
  OfflineFirstChapterRepository,
} from './src/features/chapters';
import type { ChapterRef, ChapterRepository, KeyValueStorage } from './src/features/chapters';
import { DictationRoute } from './src/features/dictation';
import {
  CallableBookExportService,
  waitForSyncedWrites,
  FirestorePendingSuggestionsRepository,
  InMemoryBookExportService,
  InMemoryExportFileSink,
  InMemoryPendingSuggestionsRepository,
  ShareSheetExportFileSink,
} from './src/features/export';
import type {
  BookExportService,
  ExportFileSink,
  PendingSuggestionsRepository,
} from './src/features/export';
import {
  FirestoreNoteRepository,
  InMemoryNoteRepository,
  LocalNoteRepository,
  NotesScreen,
  OfflineFirstNoteRepository,
} from './src/features/notes';
import type { NoteRepository } from './src/features/notes';
import { CallableOutlineService, InMemoryOutlineService } from './src/features/outline';
import type { OutlineService } from './src/features/outline';
import {
  ChapterReviewFlow,
  CallableSuggestionsProvider,
  FakeSuggestionsProvider,
  InMemoryRevisionRepository,
  LocalRevisionRepository,
} from './src/features/review';
import type { RevisionRepository, SuggestionsProvider } from './src/features/review';
import {
  CallableBackupService,
  InMemoryBackupService,
  LocalSettingsRepository,
  SettingsScreen,
  resolveThemeMode,
} from './src/features/settings';
import type { BackupService, SettingsRepository } from './src/features/settings';
import { ensureSignedIn } from './src/lib/auth';
import { auth, firestore, functions } from './src/lib/firebase';
import { toRoman } from './src/lib/roman';

/** All the screens' dependencies: injectable in tests. */
export interface AppServices {
  bookRepository: BookRepository;
  chapterRepository: ChapterRepository;
  noteRepository: NoteRepository;
  settingsRepository: SettingsRepository;
  dailyProgressRepository: DailyProgressRepository;
  revisionRepository: RevisionRepository;
  suggestionsProvider: SuggestionsProvider;
  exportService: BookExportService;
  pendingSuggestions: PendingSuggestionsRepository;
  exportFileSink: ExportFileSink;
  waitForSync?: () => Promise<boolean>;
  backupService: BackupService;
  outlineService: OutlineService;
}

export interface AppProps {
  /** Injectable in tests; default: real Firebase (emulators in development). */
  createServices?: (uid: string) => AppServices;
  signIn?: () => Promise<string>;
}

function defaultServices(uid: string): AppServices {
  const dailyProgressRepository = new LocalDailyProgressRepository();
  const chapterRepository = new OfflineFirstChapterRepository({
    remote: new FirestoreChapterRepository({ db: firestore, uid }),
    mirror: new LocalChapterRepository(),
    onWordsAdded: (delta) => {
      dailyProgressRepository.addWords(delta).catch(() => {});
    },
  });
  return {
    bookRepository: new FirestoreBookRepository({ db: firestore, uid }),
    chapterRepository,
    // offline-first like chapters: durable outbox on AsyncStorage + Firestore,
    // so a note created offline is not lost even if the app is killed
    noteRepository: new OfflineFirstNoteRepository({
      remote: new FirestoreNoteRepository({ db: firestore, uid }),
      mirror: new LocalNoteRepository(),
    }),
    settingsRepository: new LocalSettingsRepository(),
    dailyProgressRepository,
    revisionRepository: new LocalRevisionRepository(),
    // real refinement: refineChapter callable behind the same interface
    suggestionsProvider: new CallableSuggestionsProvider({ functions }),
    exportService: new CallableBookExportService({ functions }),
    pendingSuggestions: new FirestorePendingSuggestionsRepository({ db: firestore, uid }),
    exportFileSink: new ShareSheetExportFileSink(),
    waitForSync: () => waitForSyncedWrites(firestore),
    backupService: new CallableBackupService({ functions }),
    outlineService: new CallableOutlineService({ functions }),
  };
}

// ── E2E mode ────────────────────────────────────────────────────
// Every Maestro run starts clean: everything in memory, no AsyncStorage or
// Firebase. The dictation chapter is NOT seeded: the flow checks exactly the
// "empty chapter → dictation → saved" path.
const E2E_CHAPTER: ChapterRef = { bookId: 'libro-di-prova', chapterId: 'capitolo-1' };

// Chapter already written for the review-accept flow: the text triggers two
// FakeSuggestionsProvider rules — «posò lentamente» (style, 3 variants) and
// «un altra» (grammar, one proposal) — which the flow accepts and rejects.
const E2E_REVIEW_CHAPTER: ChapterRef = { bookId: E2E_CHAPTER.bookId, chapterId: 'capitolo-2' };
const E2E_REVIEW_TEXT = 'Elena posò lentamente la tazza sul tavolo. Prese un altra decisione.';
const e2eEngine = isE2E ? createE2EDictationEngine() : undefined;
const e2eChecks = isE2E ? e2ePreflightChecks : undefined;

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
}

function e2eServices(): AppServices {
  const books = new InMemoryBookRepository();
  books.seed({ id: E2E_CHAPTER.bookId, title: 'Il libro di prova' });
  const chapters = new InMemoryChapterRepository();
  chapters.seed(E2E_REVIEW_CHAPTER, E2E_REVIEW_TEXT, { title: 'La tazza' });
  return {
    bookRepository: books,
    chapterRepository: chapters,
    noteRepository: new InMemoryNoteRepository(),
    settingsRepository: new LocalSettingsRepository(memoryStorage()),
    dailyProgressRepository: new LocalDailyProgressRepository(memoryStorage()),
    revisionRepository: new InMemoryRevisionRepository(),
    suggestionsProvider: new FakeSuggestionsProvider(),
    exportService: new InMemoryBookExportService(),
    // 2 fixed pending suggestions: they make the Export tab warning appear
    // (export-epub flow); the real per-book count comes from the Firestore repository.
    pendingSuggestions: new InMemoryPendingSuggestionsRepository(2),
    exportFileSink: new InMemoryExportFileSink(),
    backupService: new InMemoryBackupService(),
    outlineService: new InMemoryOutlineService(),
  };
}
// ────────────────────────────────────────────────────────────────────────────

type Route =
  | { name: 'library' }
  | { name: 'book'; bookId: string }
  | { name: 'dictation'; chapter: ChapterRef; title: string }
  | { name: 'editor'; chapter: ChapterRef; title: string }
  | { name: 'notes'; bookId: string; bookTitle: string }
  | { name: 'progress' }
  | { name: 'settings' };

const INITIAL_STACK: Route[] = isE2E
  ? [{ name: 'library' }, { name: 'dictation', chapter: E2E_CHAPTER, title: 'Capitolo I' }]
  : [{ name: 'library' }];

function ThemedStatusBar() {
  const { mode } = useTheme();
  return <StatusBar style={mode === 'paper' ? 'dark' : 'light'} />;
}

function AppNavigator({ services }: { services: AppServices }) {
  const [stack, setStack] = useState<Route[]>(INITIAL_STACK);
  const route = stack[stack.length - 1];
  const language = useLanguage();
  const { setMode } = useTheme();
  const systemScheme = useColorScheme();

  // apply the saved interface language and theme at startup ('system' = device
  // language; 'auto' theme follows the system scheme). Settings applies later
  // changes by itself, but the saved choice must hold from the first screen.
  useEffect(() => {
    let cancelled = false; // a slower, older read must not overwrite a newer one
    services.settingsRepository
      .load()
      .then((settings) => {
        if (cancelled) return;
        setLanguage(resolveLanguage(settings.uiLanguage ?? 'system'));
        setMode(resolveThemeMode(settings.theme, systemScheme));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [services, setMode, systemScheme]);

  const push = (next: Route) => setStack((current) => [...current, next]);
  const pop = () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));

  // Android back button: pops the stack until the Library is reached
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      let handled = false;
      setStack((current) => {
        handled = current.length > 1;
        return handled ? current.slice(0, -1) : current;
      });
      return handled;
    });
    return () => subscription.remove();
  }, []);

  // a language change re-renders the current screen with the new strings
  // (the navigation stack is kept)
  return <Fragment key={language}>{renderRoute()}</Fragment>;

  function renderRoute() {
    switch (route.name) {
      case 'book':
        return (
          <BookScreen
            bookId={route.bookId}
            bookRepository={services.bookRepository}
            chapterRepository={services.chapterRepository}
            exportService={services.exportService}
            pendingSuggestions={services.pendingSuggestions}
            exportFileSink={services.exportFileSink}
            waitForSync={services.waitForSync}
            outlineService={services.outlineService}
            onBack={pop}
            onOpenChapter={(chapter, position) =>
              push({
                name: 'editor',
                chapter: { bookId: chapter.bookId, chapterId: chapter.id },
                title: `${toRoman(position)} · ${chapter.title}`,
              })
            }
            onDictateChapter={(chapter, position) =>
              push({
                name: 'dictation',
                chapter: { bookId: chapter.bookId, chapterId: chapter.id },
                title: t('common.chapterTitle', { roman: toRoman(position), title: chapter.title }),
              })
            }
            onOpenNotes={(bookTitle) => push({ name: 'notes', bookId: route.bookId, bookTitle })}
          />
        );
      case 'dictation':
        return (
          <DictationRoute
            bookRepository={services.bookRepository}
            // key: changing chapter remounts the screen (fresh session)
            key={`${route.chapter.bookId}/${route.chapter.chapterId}`}
            chapter={route.chapter}
            chapterTitle={route.title}
            repository={services.chapterRepository}
            outlineRepository={services.chapterRepository}
            engine={e2eEngine}
            preflightChecks={e2eChecks}
            onBack={pop}
          />
        );
      case 'editor':
        return (
          <ChapterReviewFlow
            key={`${route.chapter.bookId}/${route.chapter.chapterId}`}
            chapter={route.chapter}
            chapterTitle={route.title}
            chapterRepository={services.chapterRepository}
            revisionRepository={services.revisionRepository}
            provider={services.suggestionsProvider}
            onBack={pop}
          />
        );
      case 'notes':
        return (
          <NotesScreen
            key={route.bookId}
            bookId={route.bookId}
            bookTitle={route.bookTitle}
            noteRepository={services.noteRepository}
            onBack={pop}
          />
        );
      case 'progress':
        return (
          <ProgressScreen
            dailyProgressRepository={services.dailyProgressRepository}
            settingsRepository={services.settingsRepository}
            bookRepository={services.bookRepository}
            onBack={pop}
          />
        );
      case 'settings':
        return (
          <SettingsScreen
            repository={services.settingsRepository}
            backupService={services.backupService}
            backupFileSink={services.exportFileSink}
            onBack={pop}
          />
        );
      default:
        return (
          <LibraryScreen
            bookRepository={services.bookRepository}
            settingsRepository={services.settingsRepository}
            dailyProgressRepository={services.dailyProgressRepository}
            onOpenBook={(book) => push({ name: 'book', bookId: book.id })}
            onOpenSettings={() => push({ name: 'settings' })}
            onOpenProgress={() => push({ name: 'progress' })}
          />
        );
    }
  }
}

export default function App({ createServices, signIn }: AppProps = {}) {
  const fontsReady = useAppFonts();
  const [uid, setUid] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const doSignIn = signIn ?? (isE2E ? async () => 'utente-e2e' : () => ensureSignedIn(auth));
    doSignIn()
      .then((nextUid) => {
        if (!cancelled) setUid(nextUid);
      })
      .catch(() => {
        if (!cancelled) setAuthError(true);
      });
    return () => {
      cancelled = true;
    };
    // the sign-in flow is fixed for the lifetime of the app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const services = useMemo(() => {
    if (uid === null) return null;
    return (createServices ?? (isE2E ? e2eServices : defaultServices))(uid);
    // the factory is fixed for the lifetime of the app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  if (!fontsReady || (services === null && !authError)) {
    // blank screen in the default (black and gold) background until fonts and identity are ready
    // (no flash of the wrong serif, no Library without data)
    return <View style={[styles.container, { backgroundColor: candlelightPalette.background }]} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        {services === null ? (
          <View
            testID="auth-error"
            style={[
              styles.container,
              { backgroundColor: candlelightPalette.background, padding: 32 },
            ]}
          >
            <Text style={styles.errorText}>
              L’app non riesce a preparare l’archivio. Riavviala; se succede in sviluppo, controlla
              che gli emulatori Firebase siano accesi.
            </Text>
          </View>
        ) : (
          <AppNavigator services={services} />
        )}
        <ThemedStatusBar />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: candlelightPalette.text,
    fontSize: 16,
    textAlign: 'center',
  },
});
