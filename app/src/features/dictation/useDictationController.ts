// Controller React della schermata Dettatura: lega DictationSession (motore +
// state machine) al ChapterRepository con queste regole:
//  - ogni finale aggiorna subito lo stato locale; il repository riceve con
//    debounce 3 s, MA pausa/interruzione/background/chiusura salvano subito
//    (regola di convivenza 3 — il testo non si perde MAI);
//  - pre-flight a inizio schermata;
//  - keep-awake mentre si ascolta, pausa automatica su passaggio in background
//    o blocco schermo — l'interruzione audio la gestisce già la sessione;
//  - aptica su start/pausa/ripresa e sulle pause automatiche.

import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ChapterRef, ChapterTextRepository } from '../chapters';
import { appendText, countWords } from '../../lib/text';
import { DebouncedSaver, type SaveStatus } from './autosave';
import { DictationSession } from './DictationSession';
import type { DictationEngine, DictationError } from './types';
import type { SessionState } from './sessionMachine';
import {
  runPreflight,
  createNativePreflightChecks,
  type PreflightChecks,
  type PreflightReport,
} from './preflight';

const KEEP_AWAKE_TAG = 'bookvoice-dictation';

export interface DictationControllerOptions {
  engine: DictationEngine;
  repository: ChapterTextRepository;
  chapter: ChapterRef;
  /** Debounce verso il repository (default 3000 ms: 3–5 s). */
  debounceMs?: number;
  lang?: string;
  /** Controlli di pre-flight; default: quelli nativi. Iniettabili nei test. */
  preflightChecks?: PreflightChecks;
}

export interface DictationController {
  /** Caricamento del testo esistente dal repository. */
  loadState: 'loading' | 'ready' | 'load-error';
  sessionState: SessionState;
  /** Testo consolidato: capitolo + sessione corrente (in inchiostro). */
  fullText: string;
  /** Parziale effimero del motore (in grigio attenuato). */
  partial: string;
  /** Parole aggiunte da quando la schermata è stata aperta. */
  sessionWords: number;
  saveStatus: SaveStatus;
  dictationError?: DictationError;
  /** true se la pausa corrente è automatica (telefonata, rete, background). */
  pausedByInterruption: boolean;
  preflight: PreflightReport | undefined;
  /** true finché il pre-flight non è concluso. */
  preflightRunning: boolean;
  micDisabled: boolean;
  toggleMic: () => void;
  rerunPreflight: () => void;
}

const haptic = (fn: () => Promise<unknown>) => {
  fn().catch(() => {
    // l'aptica è decorativa: mai far fallire la dettatura per un motorino
  });
};

export function useDictationController(options: DictationControllerOptions): DictationController {
  const { engine, repository, chapter } = options;

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'load-error'>('loading');
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [baseText, setBaseText] = useState('');
  const [sessionText, setSessionText] = useState('');
  const [partial, setPartial] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [dictationError, setDictationError] = useState<DictationError | undefined>();
  const [pausedByInterruption, setPausedByInterruption] = useState(false);
  const [preflight, setPreflight] = useState<PreflightReport | undefined>();
  const [preflightRunning, setPreflightRunning] = useState(true);

  // ref speculari per i callback della sessione (evitano chiusure stantie)
  const baseTextRef = useRef('');
  const initialWordsRef = useRef(0);
  const holder = useRef<{ session?: DictationSession; saver?: DebouncedSaver }>({}).current;
  // dopo lo smontaggio il flush di chiusura DEVE ancora girare (salvataggio),
  // ma niente più setState: la schermata non c'è più
  const unmountedRef = useRef(false);

  const saver = useMemo(
    () =>
      new DebouncedSaver({
        save: (text) => repository.saveRawText(chapter, text),
        delayMs: options.debounceMs,
        onStatus: (status) => {
          if (!unmountedRef.current) setSaveStatus(status);
        },
      }),
    // il repository e il capitolo sono fissi per la vita della schermata
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const session = useMemo(
    () =>
      new DictationSession({
        engine,
        lang: options.lang,
        onFlush: (text) => saver.flushNow(appendText(baseTextRef.current, text)),
        onPartial: (raw) => {
          if (!unmountedRef.current) setPartial(raw);
        },
        onTextChange: (text) => {
          saver.schedule(appendText(baseTextRef.current, text));
          if (unmountedRef.current) return;
          setSessionText(text);
          setPartial('');
        },
        onStateChange: (state) => {
          if (unmountedRef.current) return;
          setSessionState(state);
          if (state !== 'listening') setPartial('');
          if (state === 'listening') setPausedByInterruption(false);
          if (state === 'error') setDictationError(holder.session?.error);
        },
        onEvent: (event) => {
          if (event.type === 'audio-interruption' && !unmountedRef.current) {
            setPausedByInterruption(true);
            haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
          }
        },
      }),
    // motore e opzioni sono fissi per la vita della schermata
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  holder.session = session;
  holder.saver = saver;

  // caricamento del testo esistente (il capitolo può essere già iniziato)
  useEffect(() => {
    let cancelled = false;
    repository
      .loadRawText(chapter)
      .then((text) => {
        if (cancelled) return;
        const initial = text ?? '';
        baseTextRef.current = initial;
        initialWordsRef.current = countWords(initial);
        setBaseText(initial);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('load-error');
      });
    return () => {
      cancelled = true;
    };
    // il capitolo è fisso per la vita della schermata
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pre-flight: permesso mic, servizio, lingua offline; il nonce
  // permette di rieseguirlo su richiesta (bottone "Ricontrolla")
  const [preflightNonce, setPreflightNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const checks = options.preflightChecks ?? createNativePreflightChecks();
    runPreflight(checks, options.lang)
      .then((report) => {
        if (!cancelled) setPreflight(report);
      })
      .catch(() => {
        // un pre-flight che esplode non deve murare la schermata: si procede
        // senza esito e sarà il motore a segnalare l'eventuale problema vero
        if (!cancelled) setPreflight({ ok: true, issues: [] });
      })
      .finally(() => {
        if (!cancelled) setPreflightRunning(false);
      });
    return () => {
      cancelled = true;
    };
    // controlli e lingua fissi per la vita della schermata
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflightNonce]);
  const rerunPreflight = useCallback(() => {
    setPreflightRunning(true);
    setPreflight(undefined);
    setPreflightNonce((nonce) => nonce + 1);
  }, []);

  // pausa automatica quando l'app va in background o lo schermo si blocca
  //; se non si sta ascoltando, comunque flush: mai testo solo in RAM
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') return;
      const current = holder.session;
      if (!current) return;
      if (current.state === 'listening') current.pause();
      else current.flush();
    });
    return () => subscription.remove();
  }, [holder]);

  // schermo acceso finché si ascolta (keep-awake)
  useEffect(() => {
    if (sessionState !== 'listening') return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [sessionState]);

  // chiusura schermata: stop (flush + motore giù) e rilascio risorse
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      holder.session?.stop();
      holder.session?.dispose();
      holder.saver?.dispose();
    };
  }, [holder]);

  const toggleMic = useCallback(() => {
    const current = holder.session;
    if (!current) return;
    switch (current.state) {
      case 'listening':
        haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
        current.pause();
        break;
      case 'paused':
        haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
        current.start();
        break;
      case 'error':
        current.reset();
      // falls through: da idle si riparte consolidando la sessione precedente
      case 'idle': {
        const folded = appendText(baseTextRef.current, current.text);
        baseTextRef.current = folded;
        setBaseText(folded);
        setSessionText('');
        setDictationError(undefined);
        haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
        current.start();
        break;
      }
      default:
        break; // committing: si attende la chiusura
    }
  }, [holder]);

  const fullText = appendText(baseText, sessionText);
  const sessionWords = Math.max(0, countWords(fullText) - initialWordsRef.current);
  const micDisabled =
    loadState !== 'ready' || preflightRunning || (preflight !== undefined && !preflight.ok);

  return {
    loadState,
    sessionState,
    fullText,
    partial,
    sessionWords,
    saveStatus,
    dictationError,
    pausedByInterruption,
    preflight,
    preflightRunning,
    micDisabled,
    toggleMic,
    rerunPreflight,
  };
}
