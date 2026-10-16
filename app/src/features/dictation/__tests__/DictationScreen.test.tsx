// Test di componente della schermata Dettatura con il FakeDictationEngine e il
// repository in memoria: flusso detta→pausa→riprendi→flush, comandi vocali,
// debounce verso il repository, background, doppio `end`, pre-flight.

import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { DictationScreen } from '../DictationScreen';
import { FakeDictationEngine } from '../engines/FakeDictationEngine';
import type { PreflightChecks } from '../preflight';
import { InMemoryChapterRepository } from '../../chapters';
import type { ChapterOutline, KeyValueStorage } from '../../chapters';
import { ThemeProvider } from '../../../theme';

// haptics, keep-awake e speech-recognition sono coperti dai mock automatici in
// app/__mocks__; la rete si sovrascrive qui per poter simulare l'offline.
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
  /** Se presente, il capitolo viene seminato con l'outline e la traccia è attiva. */
  outline?: ChapterOutline;
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
        repository={repository}
        engine={engine}
        preflightChecks={options?.checks ?? okChecks()}
        debounceMs={options?.debounceMs}
        outlineRepository={options?.outline === undefined ? undefined : repository}
        outlineStateStorage={outlineStateStorage}
      />
    </ThemeProvider>,
  );
  // lascia concludere caricamento del capitolo e pre-flight
  await act(async () => {});
  return { engine, repository, ...utils };
}

afterEach(() => {
  mockNetworkState.isConnected = true;
  jest.restoreAllMocks();
});

describe('DictationScreen — apertura', () => {
  it('mostra il testo già salvato del capitolo, in attesa di dettare', async () => {
    const { getByTestId } = await renderScreen({ initialText: 'Prologo già scritto.' });
    expect(getByTestId('dictation-live-text')).toHaveTextContent('Prologo già scritto.');
    expect(getByTestId('dictation-caption')).toHaveTextContent('Tocca il microfono per dettare');
    expect(getByTestId('dictation-words')).toHaveTextContent('0 parole in questa sessione');
  });

  it('capitolo mai iniziato: invito a dettare al posto del testo', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('dictation-empty-hint')).toBeTruthy();
  });
});

describe('DictationScreen — flusso completo detta → pausa → riprendi', () => {
  it('parziali in attenuato, finali consolidati con i comandi vocali, flush su pausa', async () => {
    const { engine, repository, getByTestId, queryByTestId } = await renderScreen({
      initialText: 'Prologo già scritto.',
    });

    await fireEvent.press(getByTestId('dictation-mic'));
    expect(getByTestId('dictation-caption')).toHaveTextContent(
      'In ascolto — tocca per mettere in pausa',
    );
    expect(engine.startCalls).toEqual([{ lang: 'it-IT' }]);

    await act(async () => engine.emitPartial('il vento'));
    expect(getByTestId('dictation-partial')).toHaveTextContent('il vento');

    await act(async () => engine.emitFinal('il vento soffiava virgola forte punto'));
    expect(queryByTestId('dictation-partial')).toBeNull(); // il parziale si consolida
    expect(getByTestId('dictation-live-text')).toHaveTextContent(
      'Prologo già scritto. Il vento soffiava, forte.',
    );
    expect(getByTestId('dictation-words')).toHaveTextContent('4 parole in questa sessione');

    // pausa: salvataggio IMMEDIATO, senza aspettare il debounce
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(getByTestId('dictation-caption')).toHaveTextContent('In pausa — tocca per riprendere');
    await act(async () => {});
    expect(repository.savedTexts).toContain('Prologo già scritto. Il vento soffiava, forte.');
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent(/Salvato/);

    // ripresa esplicita: il testo della sessione è conservato
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('e la porta sbatté'));
    expect(getByTestId('dictation-live-text')).toHaveTextContent(
      'Prologo già scritto. Il vento soffiava, forte. E la porta sbatté',
    );
  });

  it('un finale ritardatario dopo la pausa non si perde e viene risalvato', async () => {
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('prima parte'));
    await fireEvent.press(getByTestId('dictation-mic')); // pausa
    await act(async () => engine.emitFinal('coda consolidata dopo lo stop'));
    await act(async () => {});
    expect(getByTestId('dictation-live-text')).toHaveTextContent(
      'Prima parte coda consolidata dopo lo stop',
    );
    expect(repository.savedTexts).toContain('Prima parte coda consolidata dopo lo stop');
  });

  it('doppio end del motore: nessun doppio riavvio, testo intatto', async () => {
    const { engine, getByTestId } = await renderScreen();
    // come nello scenario reale, il riavvio non è ancora confermato (onStart)
    // quando arriva il secondo end: gli start si emettono a mano
    engine.autoEmitStart = false;
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitStart());
    await act(async () => engine.emitFinal('testo prima del giunto'));
    engine.duplicateEnd = true;
    await act(async () => engine.emitEnd()); // giunto con doppione: un solo riavvio
    expect(engine.startCalls).toHaveLength(2);
    await act(async () => engine.emitStart()); // il riavvio si conferma
    await act(async () => engine.emitFinal('e dopo'));
    expect(getByTestId('dictation-live-text')).toHaveTextContent('Testo prima del giunto e dopo');
    expect(getByTestId('dictation-caption')).toHaveTextContent(/In ascolto/);
  });
});

describe('DictationScreen — autosave con debounce (regola di convivenza 3)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('i finali aggiornano subito lo schermo, il repository dopo 3 s (una scrittura)', async () => {
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));

    await act(async () => engine.emitFinal('prima frase punto'));
    await act(async () => engine.emitFinal('seconda frase'));
    expect(getByTestId('dictation-live-text')).toHaveTextContent('Prima frase. Seconda frase');
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent('Salvataggio…');
    expect(repository.savedTexts).toEqual([]); // ancora niente: debounce in corso

    await act(async () => jest.advanceTimersByTime(2999));
    expect(repository.savedTexts).toEqual([]);
    await act(async () => jest.advanceTimersByTime(1));
    await act(async () => {});
    expect(repository.savedTexts).toEqual(['Prima frase. Seconda frase']);
    expect(getByTestId('dictation-save-indicator')).toHaveTextContent(/Salvato/);
  });
});

describe('DictationScreen — background e interruzioni', () => {
  it('passaggio in background mentre si ascolta: pausa automatica + flush', async () => {
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
    // la ripresa NON è automatica quando si torna attivi
    await act(async () => listeners.forEach((listener) => listener('active')));
    expect(getByTestId('dictation-caption')).toHaveTextContent(/In pausa/);
  });

  it('interruzione audio (telefonata): pausa automatica dichiarata e flush', async () => {
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('dettato prima della telefonata'));
    await act(async () =>
      engine.emitError({ code: 'audio-interruption', recoverable: true, message: 'telefonata' }),
    );
    expect(getByTestId('dictation-caption')).toHaveTextContent(/In pausa automatica/);
    expect(repository.savedTexts).toContain('Dettato prima della telefonata');
  });

  it('errore fatale: messaggio chiaro, il mic riparte da capo conservando il testo', async () => {
    const { engine, repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('salva questo'));
    await act(async () => engine.emitError({ code: 'unknown', recoverable: false }));
    await act(async () => {});
    expect(getByTestId('dictation-caption')).toHaveTextContent(
      'Il motore di dettatura si è fermato in modo inatteso.',
    );
    expect(repository.savedTexts).toContain('Salva questo');

    await fireEvent.press(getByTestId('dictation-mic')); // reset + nuovo start
    expect(getByTestId('dictation-caption')).toHaveTextContent(/In ascolto/);
    await act(async () => engine.emitFinal('e questo dopo'));
    expect(getByTestId('dictation-live-text')).toHaveTextContent('Salva questo E questo dopo');
  });

  it('alla chiusura della schermata il testo viene flushato', async () => {
    const { engine, repository, getByTestId, unmount } = await renderScreen();
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('ultime parole'));
    await unmount();
    await act(async () => {});
    expect(repository.savedTexts).toContain('Ultime parole');
    expect(engine.disposed).toBe(true);
  });
});

describe('DictationScreen — pre-flight e offline', () => {
  it('permesso negato per sempre: card bloccante, mic disabilitato', async () => {
    const { engine, getByTestId } = await renderScreen({
      checks: okChecks({
        getPermissions: async () => ({ granted: false, canAskAgain: false }),
        requestPermissions: async () => ({ granted: false, canAskAgain: false }),
      }),
    });
    expect(getByTestId('preflight-issue-permission-denied')).toBeTruthy();
    expect(getByTestId('preflight-action-open-settings')).toBeTruthy();
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(engine.startCalls).toEqual([]); // disabilitato: non parte nulla
  });

  it('italiano offline mancante: avviso ignorabile, la dettatura resta possibile', async () => {
    const { engine, getByTestId, queryByTestId } = await renderScreen({
      checks: okChecks({
        // l'italiano è supportato ma non installato per l'offline
        getSupportedLocales: async () => ({ locales: ['it-IT'], installedLocales: ['en-US'] }),
      }),
    });
    expect(getByTestId('preflight-issue-offline-language-missing')).toBeTruthy();
    await fireEvent.press(getByTestId('preflight-dismiss-offline-language-missing'));
    expect(queryByTestId('preflight-issue-offline-language-missing')).toBeNull();
    await fireEvent.press(getByTestId('dictation-mic'));
    expect(engine.startCalls).toHaveLength(1);
  });

  it('senza rete compare l’indicatore Offline', async () => {
    mockNetworkState.isConnected = false;
    const { getByTestId } = await renderScreen();
    expect(getByTestId('dictation-offline')).toHaveTextContent(/Offline/);
  });
});

describe('DictationScreen — traccia del capitolo', () => {
  const OUTLINE: ChapterOutline = {
    summary: 'Qualcosa non torna.',
    beats: ['La porta aperta', 'Il primo segno'],
    beatsDone: [],
  };

  it('capitolo con outline: pannello in alto, etichetta dalla parte "Capitolo N" del titolo', async () => {
    const { getByTestId } = await renderScreen({
      outline: OUTLINE,
      chapterTitle: 'Capitolo VII · La tempesta',
    });
    expect(getByTestId('outline-track')).toHaveTextContent(/Traccia · Capitolo VII/);
    expect(getByTestId('outline-beat-0')).toHaveTextContent('La porta aperta');
  });

  it('un beat spuntato mentre si detta finisce sul capitolo, la dettatura non si tocca', async () => {
    const { engine, repository, getByTestId } = await renderScreen({ outline: OUTLINE });
    await fireEvent.press(getByTestId('dictation-mic'));
    await act(async () => engine.emitFinal('la porta era aperta'));

    await fireEvent.press(getByTestId('outline-beat-0'));
    expect(getByTestId('outline-beat-0')).toBeChecked();
    await act(async () => {});
    expect((await repository.getChapter(CHAPTER))?.outline?.beatsDone).toEqual([0]);
    // il testo live è ancora lì e il mic resta in ascolto
    expect(getByTestId('dictation-live-text')).toHaveTextContent('La porta era aperta');
    expect(getByTestId('dictation-caption')).toHaveTextContent(/In ascolto/);
  });

  it('capitolo senza outline: nessun pannello (zero regressioni sul flusso esistente)', async () => {
    const { queryByTestId } = await renderScreen({ initialText: 'Testo senza traccia.' });
    expect(queryByTestId('outline-track')).toBeNull();
  });
});
