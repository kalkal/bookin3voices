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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { BackHandler, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { resolveLanguage, setLanguage, t } from './src/i18n';
import { useLanguage } from './src/i18n/useLanguage';
import { StartupScreen } from './src/features/startup/StartupScreen';
import {
  AccessCodeGate,
  AccessCodeModalHost,
  CallableAccessCodeService,
  GatedBackupService,
  GatedBookExportService,
  GatedOutlineService,
  GatedSuggestionsProvider,
  GatedTitleRefineService,
  isAccessGateEnabled,
  NO_SAMPLE_BOOK,
  offlineSampleServices,
  SampleModeBanner,
} from './src/features/accessCode';
import type { AccessCodeService, SampleBookHooks } from './src/features/accessCode';
import {
  createOfflineSampleRepositories,
  ExampleFallbackSuggestionsProvider,
  isSampleBookEnabled,
  seedSampleBook,
} from './src/features/sample';
import { isAiUnavailable } from './src/lib/callableErrors';
import { ThemedSystemBars, ThemeProvider, useAppFonts, useTheme } from './src/theme';
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
import type { TestLogStore } from './src/features/testLog';
import { startDeviceTestLog } from './src/features/testLog/startDeviceTestLog';
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
import {
  CallableOutlineService,
  InMemoryOutlineDraftRepository,
  InMemoryOutlineService,
  LocalOutlineDraftRepository,
} from './src/features/outline';
import type { OutlineDraftRepository, OutlineService } from './src/features/outline';
import {
  ChapterReviewFlow,
  CallableSuggestionsProvider,
  FakeSuggestionsProvider,
  FakeTitleRefineService,
  CallableTitleRefineService,
  InMemoryRevisionRepository,
  LocalRevisionRepository,
} from './src/features/review';
import type {
  RevisionRepository,
  SuggestionsProvider,
  TitleRefineService,
} from './src/features/review';
import {
  CallableBackupService,
  InMemoryBackupService,
  LocalServedModelStore,
  LocalSettingsRepository,
  SettingsScreen,
  resolveThemeMode,
} from './src/features/settings';
import type { BackupService, ServedModelSource, SettingsRepository } from './src/features/settings';
import { ensureSignedIn, hasJudgeClaim, refreshIdToken } from './src/lib/auth';
import { auth, firestore, functions } from './src/lib/firebase';
import { toRoman } from './src/lib/roman';

/** The opening screen stays at least this long, so its rays are seen even on a fast phone. */
export const STARTUP_MIN_MS = 1500;

/** All the screens' dependencies: injectable in tests. */
export interface AppServices {
  bookRepository: BookRepository;
  chapterRepository: ChapterRepository;
  noteRepository: NoteRepository;
  settingsRepository: SettingsRepository;
  dailyProgressRepository: DailyProgressRepository;
  revisionRepository: RevisionRepository;
  suggestionsProvider: SuggestionsProvider;
  /** «Rifinisci il titolo» (refineTitle callable); absent = titles cannot be refined. */
  titleService?: TitleRefineService;
  /** Model the server answered with last time (Settings); absent = server default. */
  servedModel?: ServedModelSource;
  exportService: BookExportService;
  pendingSuggestions: PendingSuggestionsRepository;
  exportFileSink: ExportFileSink;
  waitForSync?: () => Promise<boolean>;
  backupService: BackupService;
  outlineService: OutlineService;
  /** The outline preview not yet confirmed, per book. */
  outlineDrafts: OutlineDraftRepository;
  /** Dev builds only: the test log on the device (Settings › «Scarica registro»). */
  testLog?: TestLogStore;
}

/**
 * Judges build (EXPO_PUBLIC_ACCESS_GATE=1): without the `judge` claim the
 * server refuses everything, so the app starts in offline sample mode and goes
 * online once the access code is redeemed.
 */
export interface AccessModeDeps {
  /** The ID token carries `judge: true` (a code was redeemed on this account). */
  hasJudgeClaim: () => Promise<boolean>;
  /** Forces a fresh ID token after a redeem, so the claim reaches the server calls. */
  refreshIdToken: () => Promise<void>;
  accessCodeService: AccessCodeService;
  /** The bundled sample book: offline repositories, online seeding, example fallback. */
  sampleBook: SampleBookHooks<AppServices>;
}

export interface AppProps {
  /** Injectable in tests; default: real Firebase (emulators in development). */
  createServices?: (uid: string) => AppServices;
  signIn?: () => Promise<string>;
  /** Injectable in tests; default: on only in the judges build. null = off. */
  accessMode?: AccessModeDeps | null;
}

// The sample book (features/sample, judges' build): offline without the code,
// seeded into the user's space once the code is accepted, and its pre-recorded
// examples standing in when the live AI is unavailable.
const SAMPLE_BOOK_HOOKS: SampleBookHooks<AppServices> = isSampleBookEnabled
  ? {
      createOfflineRepositories: () => createOfflineSampleRepositories(),
      seedOnline: (services, uid) =>
        seedSampleBook({
          bookRepository: services.bookRepository as FirestoreBookRepository,
          marker: AsyncStorage,
          uid,
        }),
      wrapOnlineProvider: (inner) =>
        new ExampleFallbackSuggestionsProvider({ inner, isAiUnavailable }),
    }
  : (NO_SAMPLE_BOOK as SampleBookHooks<AppServices>);

function defaultAccessMode(): AccessModeDeps | null {
  if (!isAccessGateEnabled() || isE2E) return null;
  return {
    hasJudgeClaim: () => hasJudgeClaim(auth),
    refreshIdToken: () => refreshIdToken(auth),
    accessCodeService: new CallableAccessCodeService({ functions }),
    sampleBook: SAMPLE_BOOK_HOOKS,
  };
}

/** Every server call goes through the access code prompt (judges build). */
function withAccessGate(
  services: AppServices,
  gate: AccessCodeGate,
  wrapProvider: (inner: SuggestionsProvider) => SuggestionsProvider = (inner) => inner,
): AppServices {
  return {
    ...services,
    suggestionsProvider: wrapProvider(
      new GatedSuggestionsProvider(services.suggestionsProvider, gate),
    ),
    outlineService: new GatedOutlineService(services.outlineService, gate),
    exportService: new GatedBookExportService(services.exportService, gate),
    backupService: new GatedBackupService(services.backupService, gate),
    ...(services.titleService === undefined
      ? {}
      : { titleService: new GatedTitleRefineService(services.titleService, gate) }),
  };
}

/** 'redeemed': online after a code entered in this session (the sample book still to seed). */
type AccessState = 'checking' | 'offline' | 'online' | 'redeemed';

function defaultServices(uid: string): AppServices {
  const dailyProgressRepository = new LocalDailyProgressRepository();
  const chapterRepository = new OfflineFirstChapterRepository({
    remote: new FirestoreChapterRepository({ db: firestore, uid }),
    mirror: new LocalChapterRepository(),
    onWordsAdded: (delta) => {
      dailyProgressRepository.addWords(delta).catch(() => {});
    },
  });
  const servedModel = new LocalServedModelStore();
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
    titleService: new CallableTitleRefineService({ functions }),
    suggestionsProvider: new CallableSuggestionsProvider({
      functions,
      onServedModel: (model) => {
        servedModel.save(model).catch(() => {});
      },
    }),
    servedModel,
    exportService: new CallableBookExportService({ functions }),
    pendingSuggestions: new FirestorePendingSuggestionsRepository({ db: firestore, uid }),
    exportFileSink: new ShareSheetExportFileSink(),
    waitForSync: () => waitForSyncedWrites(firestore),
    backupService: new CallableBackupService({ functions }),
    outlineService: new CallableOutlineService({ functions }),
    outlineDrafts: new LocalOutlineDraftRepository(),
    // dev builds only (__DEV__ or EXPO_PUBLIC_TEST_LOG=1): null in store builds
    testLog: startDeviceTestLog() ?? undefined,
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
    titleService: new FakeTitleRefineService(),
    exportService: new InMemoryBookExportService(),
    // 2 fixed pending suggestions: they make the Export tab warning appear
    // (export-epub flow); the real per-book count comes from the Firestore repository.
    pendingSuggestions: new InMemoryPendingSuggestionsRepository(2),
    exportFileSink: new InMemoryExportFileSink(),
    backupService: new InMemoryBackupService(),
    outlineService: new InMemoryOutlineService(),
    outlineDrafts: new InMemoryOutlineDraftRepository(),
  };
}
// ────────────────────────────────────────────────────────────────────────────

type Route =
  | { name: 'library' }
  | { name: 'book'; bookId: string }
  | { name: 'dictation'; chapter: ChapterRef; title: string }
  | { name: 'editor'; chapter: ChapterRef; title: string; chapterName?: string }
  | { name: 'notes'; bookId: string; bookTitle: string }
  | { name: 'progress' }
  | { name: 'settings' };

const INITIAL_STACK: Route[] = isE2E
  ? [{ name: 'library' }, { name: 'dictation', chapter: E2E_CHAPTER, title: 'Capitolo I' }]
  : [{ name: 'library' }];

function AppNavigator({ services }: { services: AppServices }) {
  const [stack, setStack] = useState<Route[]>(INITIAL_STACK);
  const route = stack[stack.length - 1];
  const language = useLanguage();
  const { setMode, setOrnaments } = useTheme();
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
        setOrnaments(settings.ornaments ?? true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [services, setMode, setOrnaments, systemScheme]);

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
            outlineDrafts={services.outlineDrafts}
            settingsRepository={services.settingsRepository}
            onBack={pop}
            onOpenChapter={(chapter, position) =>
              push({
                name: 'editor',
                chapter: { bookId: chapter.bookId, chapterId: chapter.id },
                title: `${toRoman(position)} · ${chapter.title}`,
                chapterName: chapter.title,
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
            outlineRepository={services.chapterRepository}
            chapterName={route.chapterName}
            titleService={services.titleService}
            titleRepository={services.chapterRepository}
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
            servedModel={services.servedModel}
            testLog={services.testLog}
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

export default function App({ createServices, signIn, accessMode: accessModeProp }: AppProps = {}) {
  const fontsReady = useAppFonts();
  const [uid, setUid] = useState<string | null>(null);
  // fixed for the lifetime of the app, like the services factory
  const [accessMode] = useState(() =>
    accessModeProp === undefined ? defaultAccessMode() : accessModeProp,
  );
  const [access, setAccess] = useState<AccessState>(accessMode ? 'checking' : 'online');
  const [gate] = useState(() => {
    if (!accessMode) return null;
    return new AccessCodeGate({
      redeem: async (code) => {
        await accessMode.accessCodeService.redeem(code);
        // the claim is in the token only after a refresh: before it the server still refuses
        await accessMode.refreshIdToken();
        console.info('access-mode', { mode: 'online', via: 'redeem' });
        setAccess('redeemed');
      },
    });
  });
  const [authError, setAuthError] = useState(false);
  // bumped by the Retry button of the startup screen: opening is tried again
  const [attempt, setAttempt] = useState(0);
  // the opening screen is part of the experience, not only a loading screen: on a
  // fast phone it would flash by unseen, so it stays at least STARTUP_MIN_MS on
  // every start (the rays stand still with reduced motion; the wait stays short)
  const [minShown, setMinShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinShown(true), STARTUP_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

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
    // the sign-in flow is fixed for the lifetime of the app; only a retry reruns it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // judges build: the claim decides between offline sample mode and the server
  useEffect(() => {
    if (uid === null || !accessMode) return;
    let cancelled = false;
    accessMode
      .hasJudgeClaim()
      .catch(() => false) // unreadable token (offline, expired): stay off the server
      .then((judge) => {
        if (cancelled) return;
        console.info('access-mode', { mode: judge ? 'online' : 'offline', via: 'startup' });
        setAccess((current) => (current === 'checking' ? (judge ? 'online' : 'offline') : current));
      });
    return () => {
      cancelled = true;
    };
  }, [uid, accessMode]);

  const services = useMemo(() => {
    if (uid === null || access === 'checking') return null;
    if (access === 'offline' && accessMode && gate) {
      return withAccessGate(offlineSampleServices(accessMode.sampleBook), gate);
    }
    const online = (createServices ?? (isE2E ? e2eServices : defaultServices))(uid);
    return accessMode && gate
      ? withAccessGate(online, gate, accessMode.sampleBook.wrapOnlineProvider)
      : online;
    // the factory is fixed for the lifetime of the app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, access]);

  // after a redeem: the sample book also in the user's online space (create-if-missing)
  useEffect(() => {
    if (access !== 'redeemed' || services === null || uid === null) return;
    accessMode?.sampleBook.seedOnline(services, uid).catch((error: unknown) => {
      console.warn('sample-online-seed-failed', {
        code: error instanceof Error ? error.name : typeof error,
      });
    });
  }, [access, services, uid, accessMode]);

  if (!fontsReady || services === null || !minShown) {
    // the opening screen (black, gold mark, slow rays) until fonts and identity are
    // ready, and for at least STARTUP_MIN_MS: no flash of the wrong serif, no
    // Library without data; if opening fails it shows the error with a Retry
    // button instead of staying stuck
    return (
      <StartupScreen
        error={authError}
        onRetry={() => {
          setAuthError(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        {gate ? (
          <View style={{ flex: 1 }}>
            {access === 'offline' ? (
              <SampleModeBanner onEnterCode={() => void gate.requestCode()} />
            ) : null}
            <View style={{ flex: 1 }}>
              {/* a new key on going online: every screen remounts on the new services */}
              <AppNavigator key={access} services={services} />
            </View>
            <AccessCodeModalHost gate={gate} />
          </View>
        ) : (
          <AppNavigator services={services} />
        )}
        <ThemedSystemBars />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
