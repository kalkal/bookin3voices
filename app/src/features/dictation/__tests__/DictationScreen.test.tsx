// Component test of the Dictation screen with FakeDictationEngine and the
// in-memory repository: dictate→pause→resume→flush flow, voice commands,
// debounce toward the repository, background, double `end`, pre-flight.

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { DictationScreen } from '../DictationScreen';
import { FakeDictationEngine } from '../engines/FakeDictationEngine';
import type { PreflightChecks } from '../preflight';
import { InMemoryChapterRepository } from '../../chapters';
import type { ChapterOutline, ChapterTextRepository, KeyValueStorage } from '../../chapters';
import { ThemeProvider } from '../../../theme';

// haptics, keep-awake and speech-recognition are covered by the automatic mocks
// in app/__mocks__; the network is overridden here so offline can be simulated.
const mockNetworkState = { isConnected: true as boolean | undefined };
jest.mock('expo-network', () => ({
  useNetworkState: () => mockNetworkState,
}));

const CHAPTER = { bookId: 'libro-test', chapterId: 'cap-test' };

function okChecks(overrides: Partial<PreflightChecks> = {}): PreflightChecks {
  return {
    isRecognitionAvailable: () => true,
    getPermissions: async () => ({ granted: true, canAskAgain: true }),
    requestPermissions: async () => ({ granted: true, canAskAgain: true }),
    getSupportedLocales: async () => ({ locales: ['it-IT'], installedLocales: ['it-IT'] }),
    platform: 'android',
    ...overrides,
  };
}

async function renderScreen(options?: {
  initialText?: string;
  checks?: PreflightChecks;
  debounceMs?: number;
  chapterTitle?: string;
  /** If present, the chapter is seeded with the outline and the track is active. */
  outline?: ChapterOutline;
  /** Wraps the in-memory repository (e.g. to report a save that stayed on the phone). */
  wrapRepository?: (inner: InMemoryChapterRepository) => ChapterTextRepository;
}) {
  const engine = new FakeDictationEngine();
  const repository = new InMemoryChapterRepository();
  if (options?.initialText !== undefined || options?.outline !== undefined) {
    repository.seed(CHAPTER, options.initialText ?? '', { outline: options.outline ?? null });
  }
  const storageData = new Map<string, string>();
  const outlineStateStorage: KeyValueStorage = {
    getItem: async (key) => storageData.get(key) ?? null,
    setItem: async (key, value) => {
      storageData.set(key, value);
    },
  };
  const utils = await render(
    <ThemeProvider>
      <DictationScreen
        chapter={CHAPTER}
        chapterTitle={options?.chapterTitle ?? 'Capitolo I'}
        repository={options?.wrapRepository?.(repository) ?? repository}
        engine={engine}
        preflightChecks={options?.checks ?? okChecks()}
        debounceMs={options?.debounceMs}
        outlineRepository={options?.outline === undefined ? undefined : repository}
        outlineStateStorage={outlineStateStorage}
      />
    </ThemeProvider>,
  );
  // let the chapter load and the pre-flight finish
  await act(async () => {});
  return { engine, repository, ...utils };
}

afterEach(() => {
  mockNetworkState.isConnected = true;
  jest.restoreAllMocks();
});

describe('DictationScreen — opening', () => {
  it('shows the chapter text already saved, waiting for dictation', async () => {
    const { getByTestId } = await renderScreen({ initialText: 'Prologo già scritto.' });
    expect(getByTestId('dictation-live-text')).toHaveTextContent('Prologo già scritto.');
    expect(getByTestId('dictation-caption')).toHaveTextContent('Tocca il microfono per dettare');
    expect(getByTestId('dictation-words')).toHaveTextContent('0 parole in questa sessione');
  });

  it('chapter never started: prompt to dictate in place of the text', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('dictation-empty-hint')).toBeTruthy();
  });
});

describe('DictationScreen — full flow dictate → pause → resume', () => {
  it('interim results dimmed, finals consolidated with voice commands, flush on pause', async () => {
    const { engine, repository, getByTestId, queryByTestId } = await renderScreen({
      initialText: 'Prologo già scritto.',
    });

    await fireEvent.press(getByTestId('dictation-mic'));
    expect(getByTestId('dictation-caption')).toHaveTextContent('Sto ascoltando…');
    expect(engine.startCalls).toEqual([{ lang: 'it-IT' }]);

    await act(async () => engine.emitPartial('il vento'));
    expect(getByTestId('dictation-partial')).toHaveTextContent('il vento');

    await act(async () => engine.emitFinal('il vento soffiava virgola forte punto'));
    expect(queryByTestId('dictation-partial')).toBeNull(); // the interim result is consolidated
    expect(getByTestId('dictation-live-text')).toHaveTextContent(
      'Prologo già scritto. Il vento soffiava, forte.',
    );
    expect(getByTestId('dictation-words')).toHaveTextContent('4 parole in questa sessione');

    // pause: IMMEDIATE save, without waiting for the debounce
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(getByTestId('dictation-caption')).toHaveTextContent('In pausa — tocca per riprendere');
    await act(async () => {});
    expect(repository.savedTexts).toContain('Prologo già scritto. Il vento soffiava, forte.');
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent(/Salvato/);

    // explicit resume: the session text is kept
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('e la porta sbatté'));
    expect(getByTestId('dictation-live-text')).toHaveTextContent(
      'Prologo già scritto. Il vento soffiava, forte. E la porta sbatté',
    );
  });

  it('a late final after the pause is not lost and is saved again', async () => {
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('prima parte'));
    await fireEvent.press(getByTestId('dictation-mic')); // pause
    await act(async () => engine.emitFinal('coda consolidata dopo lo stop'));
    await act(async () => {});
    expect(getByTestId('dictation-live-text')).toHaveTextContent(
      'Prima parte coda consolidata dopo lo stop',
    );
    expect(repository.savedTexts).toContain('Prima parte coda consolidata dopo lo stop');
  });

  it('double engine end: no double restart, text intact', async () => {
    const { engine, getByTestId } = await renderScreen();
    // as in the real scenario, the restart is not yet confirmed (onStart)
    // when the second end arrives: starts are emitted by hand
    engine.autoEmitStart = false;
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitStart());
    await act(async () => engine.emitFinal('testo prima del giunto'));
    engine.duplicateEnd = true;
    await act(async () => engine.emitEnd()); // seam with a duplicate: a single restart
    await waitFor(() => expect(engine.startCalls).toHaveLength(2)); // after the short restart wait
    await act(async () => engine.emitStart()); // the restart is confirmed
    await act(async () => engine.emitFinal('e dopo'));
    expect(getByTestId('dictation-live-text')).toHaveTextContent('Testo prima del giunto e dopo');
    expect(getByTestId('dictation-caption')).toHaveTextContent(/Sto ascoltando/);
  });
});

describe('DictationScreen — microphone state is visible', () => {
  it('listening shows the gold mic; paused the slashed grey mic, with words', async () => {
    const { getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(getByTestId('dictation-mic-icon-mic')).toBeOnTheScreen();
    expect(getByTestId('dictation-caption')).toHaveTextContent('Sto ascoltando…');
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(getByTestId('dictation-mic-icon-mic-off')).toBeOnTheScreen();
    expect(getByTestId('dictation-caption')).toHaveTextContent('In pausa — tocca per riprendere');
  });
});

describe('DictationScreen — debounced autosave', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('finals update the screen immediately, the repository after 3 s (one write)', async () => {
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));

    await act(async () => engine.emitFinal('prima frase punto'));
    await act(async () => engine.emitFinal('seconda frase'));
    expect(getByTestId('dictation-live-text')).toHaveTextContent('Prima frase. Seconda frase');
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent('Salvataggio…');
    expect(repository.savedTexts).toEqual([]); // nothing yet: debounce in progress

    await act(async () => jest.advanceTimersByTime(2999));
    expect(repository.savedTexts).toEqual([]);
    await act(async () => jest.advanceTimersByTime(1));
    await act(async () => {});
    expect(repository.savedTexts).toEqual(['Prima frase. Seconda frase']);
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent(/Salvato/);
  });
});

describe('DictationScreen — honest save indicator', () => {
  it('opening a chapter does not claim «Salvato» before anything is saved', async () => {
    const { getByTestId, queryByText } = await renderScreen({ initialText: 'Prologo.' });
    expect(queryByText(/Salvato/)).toBeNull();
    expect(getByTestId('dictation-caption')).toHaveTextContent('Tocca il microfono per dettare');
  });

  it('starting to dictate still does not claim «Salvato»; it appears after the save', async () => {
    const { engine, getByTestId, queryByText } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(queryByText(/Salvato/)).toBeNull();
    await act(async () => engine.emitFinal('una frase'));
    expect(queryByText(/Salvato/)).toBeNull();
    await fireEvent.press(getByTestId('dictation-mic')); // pause → immediate save
    await act(async () => {});
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent(/^\W*Salvato$/);
  });

  it('cloud down, text safe on the phone: says so instead of «Salvato»', async () => {
    const { engine, getByTestId } = await renderScreen({
      wrapRepository: (inner) => ({
        loadRawText: (ref) => inner.loadRawText(ref),
        saveRawText: async (ref, text) => {
          await inner.saveRawText(ref, text);
          return 'local-only' as const;
        },
      }),
    });
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('una frase'));
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => {});
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent(
      /Salvato sul telefono, sincronizzo appena possibile/,
    );
  });

  it('offline: a save is on the phone only, and the indicator says so', async () => {
    mockNetworkState.isConnected = false;
    const { engine, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('una frase'));
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => {});
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent(
      /Salvato sul telefono, sincronizzo appena possibile/,
    );
  });
});

describe('DictationScreen — background and interruptions', () => {
  it('moving to background while listening: automatic pause + flush', async () => {
    const listeners: ((state: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listeners.push(handler as (state: AppStateStatus) => void);
      return { remove: jest.fn() } as ReturnType<typeof AppState.addEventListener>;
    });
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('testo da mettere in salvo'));

    await act(async () => listeners.forEach((listener) => listener('background')));
    await act(async () => {});

    expect(getByTestId('dictation-caption')).toHaveTextContent(/In pausa/);
    expect(repository.savedTexts).toContain('Testo da mettere in salvo');
    // resuming is NOT automatic when the app becomes active again
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(getByTestId('dictation-caption')).toHaveTextContent(/In pausa/);
  });

  it('audio interruption (phone call): automatic pause declared, and flush', async () => {
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('dettato prima della telefonata'));
    await act(async () =>
      engine.emitError({ code: 'audio-interruption', recoverable: true, message: 'telefonata' }),
    );
    expect(getByTestId('dictation-caption')).toHaveTextContent(/In pausa automatica/);
    expect(repository.savedTexts).toContain('Dettato prima della telefonata');
  });

  it('engine busy (Galaxy A53 after a silence): keeps listening, logs only the code', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { engine, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('il mulino era fermo'));
    await act(async () =>
      engine.emitError({
        code: 'busy',
        recoverable: true,
        nativeCode: 'busy',
        message: 'il mulino',
      }),
    );
    await act(async () => engine.emitSingleEnd());
    // engine off during the wait: the mic must not claim it is listening
    expect(getByTestId('dictation-caption')).toHaveTextContent('Riconnessione…');
    expect(getByTestId('dictation-mic-icon-sync')).toBeOnTheScreen();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(engine.startCalls).toHaveLength(2);
    expect(getByTestId('dictation-caption')).toHaveTextContent(/Sto ascoltando/);
    expect(getByTestId('dictation-mic-icon-mic')).toBeOnTheScreen();
    expect(warn).toHaveBeenCalledWith('dictation-engine-error', {
      code: 'busy',
      nativeCode: 'busy',
      recoverable: true,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/mulino/);
    jest.useRealTimers();
  });

  it('two minutes without speech: pause that says why', async () => {
    jest.useFakeTimers();
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('ultima frase'));
    await act(async () => jest.advanceTimersByTime(120_000));
    expect(getByTestId('dictation-caption')).toHaveTextContent(
      'In pausa automatica: nessuna voce da 2 minuti — tocca per riprendere',
    );
    expect(repository.savedTexts).toContain('Ultima frase');
    jest.useRealTimers();
  });

  it('fatal error: clear message, the mic restarts fresh while keeping the text', async () => {
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('salva questo'));
    await act(async () => engine.emitError({ code: 'unknown', recoverable: false }));
    await act(async () => {});
    expect(getByTestId('dictation-caption')).toHaveTextContent(
      'Il motore di dettatura si è fermato in modo inatteso.',
    );
    expect(repository.savedTexts).toContain('Salva questo');

    await fireEvent.press(getByTestId('dictation-mic')); // reset + new start
    expect(getByTestId('dictation-caption')).toHaveTextContent(/Sto ascoltando/);
    await act(async () => engine.emitFinal('e questo dopo'));
    expect(getByTestId('dictation-live-text')).toHaveTextContent('Salva questo E questo dopo');
  });

  it('on screen close the text is flushed', async () => {
    const { engine, repository, getByTestId, unmount } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('ultime parole'));
    await unmount();
    await act(async () => {});
    expect(repository.savedTexts).toContain('Ultime parole');
    expect(engine.disposed).toBe(true);
  });
});

describe('DictationScreen — pre-flight and offline', () => {
  it('permission denied permanently: blocking card, mic disabled', async () => {
    const { engine, getByTestId } = await renderScreen({
      checks: okChecks({
        getPermissions: async () => ({ granted: false, canAskAgain: false }),
        requestPermissions: async () => ({ granted: false, canAskAgain: false }),
      }),
    });
    expect(getByTestId('preflight-issue-permission-denied')).toBeTruthy();
    expect(getByTestId('preflight-action-open-settings')).toBeTruthy();
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(engine.startCalls).toEqual([]); // disabled: nothing starts
  });

  it('offline Italian missing: dismissible warning, dictation stays possible', async () => {
    const { engine, getByTestId, queryByTestId } = await renderScreen({
      checks: okChecks({
        // Italian is supported but not installed for offline use
        getSupportedLocales: async () => ({ locales: ['it-IT'], installedLocales: ['en-US'] }),
      }),
    });
    expect(getByTestId('preflight-issue-offline-language-missing')).toBeTruthy();
    await fireEvent.press(getByTestId('preflight-dismiss-offline-language-missing'));
    expect(queryByTestId('preflight-issue-offline-language-missing')).toBeNull();
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(engine.startCalls).toHaveLength(1);
  });

  it('without network the Offline indicator appears', async () => {
    mockNetworkState.isConnected = false;
    const { getByTestId } = await renderScreen();
    expect(getByTestId('dictation-offline')).toHaveTextContent(/Offline/);
  });
});

describe('DictationScreen — chapter track', () => {
  const OUTLINE: ChapterOutline = {
    summary: 'Qualcosa non torna.',
    beats: ['La porta aperta', 'Il primo segno'],
    beatsDone: [],
  };

  it('chapter with outline: panel on top, label from the "Capitolo N" part of the title', async () => {
    const { getByTestId } = await renderScreen({
      outline: OUTLINE,
      chapterTitle: 'Capitolo VII · La tempesta',
    });
    expect(getByTestId('outline-track')).toHaveTextContent(/Traccia · Capitolo VII/);
    expect(getByTestId('outline-beat-0')).toHaveTextContent('La porta aperta');
  });

  it('a beat ticked while dictating lands on the chapter, dictation is untouched', async () => {
    const { engine, repository, getByTestId } = await renderScreen({ outline: OUTLINE });
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('la porta era aperta'));

    await fireEvent.press(getByTestId('outline-beat-0'));
    expect(getByTestId('outline-beat-0')).toBeChecked();
    await act(async () => {});
    expect((await repository.getChapter(CHAPTER))?.outline?.beatsDone).toEqual([0]);
    // the live text is still there and the mic keeps listening
    expect(getByTestId('dictation-live-text')).toHaveTextContent('La porta era aperta');
    expect(getByTestId('dictation-caption')).toHaveTextContent(/Sto ascoltando/);
  });

  it('chapter without outline: no panel (no regressions on the existing flow)', async () => {
    const { queryByTestId } = await renderScreen({ initialText: 'Testo senza traccia.' });
    expect(queryByTestId('outline-track')).toBeNull();
  });
});
