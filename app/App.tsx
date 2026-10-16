/**
 * Radice dell'app: bootstrap dell'identità (accesso anonimo,
 * lib/auth), costruzione dei repository (Firestore + mirror offline-first) e
 * navigazione a stack tra le schermate dell'app:
 * Libreria → Libro → Dettatura / Editor+Review, ingranaggio →
 * Impostazioni. Uno stack fatto in casa basta per queste rotte; una
 * navigation library si potrà innestare qui senza toccare le schermate.
 *
 * Modalità E2E Maestro (EXPO_PUBLIC_E2E=1): niente Firebase —
 * servizi in memoria, sign-in fittizio, motore di dettatura a script e stack
 * che parte già sulla Dettatura ("Capitolo I", come si aspetta il flusso).
 */
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, paperPalette, useAppFonts, useTheme } from './src/theme';
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
import { DictationScreen } from './src/features/dictation';
import {
  CallableBookExportService,
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
} from './src/features/settings';
import type { BackupService, SettingsRepository } from './src/features/settings';
import { ensureSignedIn } from './src/lib/auth';
import { auth, firestore, functions } from './src/lib/firebase';
import { toRoman } from './src/lib/roman';

/** Tutte le dipendenze delle schermate: iniettabili nei test. */
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
  backupService: BackupService;
  outlineService: OutlineService;
}

export interface AppProps {
  /** Iniettabili nei test; default: Firebase reale (emulatori in sviluppo). */
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
    // offline-first come i capitoli: outbox durabile su AsyncStorage + Firestore,
    // così una nota creata offline non si perde nemmeno se l'app viene uccisa
    noteRepository: new OfflineFirstNoteRepository({
      remote: new FirestoreNoteRepository({ db: firestore, uid }),
      mirror: new LocalNoteRepository(),
    }),
    settingsRepository: new LocalSettingsRepository(),
    dailyProgressRepository,
    revisionRepository: new LocalRevisionRepository(),
    // rifinitura vera: callable refineChapter dietro la stessa interfaccia
    suggestionsProvider: new CallableSuggestionsProvider({ functions }),
    exportService: new CallableBookExportService({ functions }),
    pendingSuggestions: new FirestorePendingSuggestionsRepository({ db: firestore, uid }),
    exportFileSink: new ShareSheetExportFileSink(),
    backupService: new CallableBackupService({ functions }),
    outlineService: new CallableOutlineService({ functions }),
  };
}

// ── Modalità E2E ────────────────────────────────────────────────
// Ogni run Maestro parte pulito: tutto in memoria, niente AsyncStorage né
// Firebase. Il capitolo della dettatura NON è seminato: il flusso verifica
// proprio il percorso "capitolo vuoto → dettatura → salvato".
const E2E_CHAPTER: ChapterRef = { bookId: 'libro-di-prova', chapterId: 'capitolo-1' };

// Capitolo già scritto per il flusso review-accept: il testo fa scattare due
// regole del FakeSuggestionsProvider — «posò lentamente» (stile, 3 varianti)
// e «un altra» (grammatica, una proposta) — che il flusso accetta e rifiuta.
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
    // 2 pending fissi: fanno comparire l'avviso della tab Export (flusso
    // export-epub); il conteggio vero per-libro è del repository Firestore.
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

  const push = (next: Route) => setStack((current) => [...current, next]);
  const pop = () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));

  // tasto indietro Android: risale lo stack finché non si è in Libreria
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
              title: `Capitolo ${toRoman(position)} · ${chapter.title}`,
            })
          }
          onOpenNotes={(bookTitle) => push({ name: 'notes', bookId: route.bookId, bookTitle })}
        />
      );
    case 'dictation':
      return (
        <DictationScreen
          // key: cambiando capitolo si rimonta la schermata (sessione nuova)
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
    // il flusso di sign-in è fisso per la vita dell'app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const services = useMemo(() => {
    if (uid === null) return null;
    return (createServices ?? (isE2E ? e2eServices : defaultServices))(uid);
    // il factory è fisso per la vita dell'app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  if (!fontsReady || (services === null && !authError)) {
    // schermata vuota color carta finché font e identità non sono pronti
    // (niente flash di serif sbagliato, niente Libreria senza dati)
    return <View style={[styles.container, { backgroundColor: paperPalette.background }]} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        {services === null ? (
          <View
            testID="auth-error"
            style={[styles.container, { backgroundColor: paperPalette.background, padding: 32 }]}
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
    color: '#2C241B',
    fontSize: 16,
    textAlign: 'center',
  },
});
