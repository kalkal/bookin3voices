// React controller for the Dictation screen: binds DictationSession (engine +
// state machine) to the ChapterRepository with these rules:
//  - every final result updates local state immediately; the repository is
//    written with a 3 s debounce, BUT pause/interruption/background/close save
//    immediately (text is NEVER lost);
//  - pre-flight at screen start;
//  - keep-awake while listening, automatic pause when moving to background
//    or on screen lock (audio interruption is already handled by the session);
//  - haptics on start/pause/resume and on automatic pauses.

import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ChapterRef, ChapterTextRepository } from '../chapters';
import { appendText, countWords } from '../../lib/text';
import { logTestEvent } from '../testLog';
import { DebouncedSaver, type SaveStatus } from './autosave';
import { DictationSession, type AutoPauseReason } from './DictationSession';
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
  /** Debounce toward the repository (default 3000 ms; typical range 3-5 s). */
  debounceMs?: number;
  lang?: string;
  /** Pre-flight checks; defaults to the native ones. Injectable in tests. */
  preflightChecks?: PreflightChecks;
}

export interface DictationController {
  /** Loading of the existing text from the repository. */
  loadState: 'loading' | 'ready' | 'load-error';
  sessionState: SessionState;
  /** Finalized text: chapter + current session (rendered in ink). */
  fullText: string;
  /** Ephemeral interim result from the engine (rendered dimmed grey). */
  partial: string;
  /** Words added since the screen was opened. */
  sessionWords: number;
  saveStatus: SaveStatus;
  dictationError?: DictationError;
  /** true if the current pause is automatic (phone call, long silence, engine down). */
  pausedByInterruption: boolean;
  /** Listening, but the engine is off waiting to retry (busy/network). */
  reconnecting: boolean;
  /** Why the current automatic pause happened (undefined when not auto-paused). */
  autoPauseReason?: AutoPauseReason;
  preflight: PreflightReport | undefined;
  /** true until the pre-flight has finished. */
  preflightRunning: boolean;
  micDisabled: boolean;
  toggleMic: () => void;
  rerunPreflight: () => void;
}

const haptic = (fn: () => Promise<unknown>) => {
  fn().catch(() => {
    // haptics are decorative: never let a vibration failure break dictation
  });
};

export function useDictationController(options: DictationControllerOptions): DictationController {
  const { engine, repository, chapter } = options;

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'load-error'>('loading');
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [baseText, setBaseText] = useState('');
  const [sessionText, setSessionText] = useState('');
  const [partial, setPartial] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [dictationError, setDictationError] = useState<DictationError | undefined>();
  const [autoPauseReason, setAutoPauseReason] = useState<AutoPauseReason | undefined>();
  const [reconnecting, setReconnecting] = useState(false);
  const [preflight, setPreflight] = useState<PreflightReport | undefined>();
  const [preflightRunning, setPreflightRunning] = useState(true);

  // mirror refs for the session callbacks (avoid stale closures)
  const baseTextRef = useRef('');
  const initialWordsRef = useRef(0);
  const holder = useRef<{ session?: DictationSession; saver?: DebouncedSaver }>({}).current;
  const lastStateRef = useRef<string>('idle');
  // after unmount the closing flush MUST still run (saving),
  // but no more setState: the screen is gone
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
    // the repository and chapter are fixed for the screen's lifetime
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
          logTestEvent('dictation.state', {
            bookId: chapter.bookId,
            chapterId: chapter.chapterId,
            from: lastStateRef.current,
            to: state,
            lang: holder.session?.locale,
            recognizer: engine.recognizer ?? 'unknown',
            ...(state === 'error' ? { code: holder.session?.error?.code } : {}),
          });
          lastStateRef.current = state;
          if (unmountedRef.current) return;
          setSessionState(state);
          if (state !== 'listening') setPartial('');
          if (state === 'listening') setAutoPauseReason(undefined);
          if (state === 'error') setDictationError(holder.session?.error);
        },
        onEvent: (event) => {
          const { type, ...details } = event;
          logTestEvent('dictation.event', {
            chapterId: chapter.chapterId,
            event: type,
            ...(event.type === 'engine-error'
              ? {
                  code: event.error.code,
                  nativeCode: event.error.nativeCode,
                  recoverable: event.error.recoverable,
                }
              : details),
          });
          if (event.type === 'engine-error') {
            // diagnostics: the codes only, never the message (it may echo speech)
            const { code, nativeCode, recoverable } = event.error;
            console.warn('dictation-engine-error', { code, nativeCode, recoverable });
          }
          if (event.type === 'reconnecting' && !unmountedRef.current) {
            setReconnecting(event.active);
          }
          if (event.type === 'auto-pause' && !unmountedRef.current) {
            setAutoPauseReason(event.reason);
            haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
          }
        },
      }),
    // the engine and options are fixed for the screen's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  holder.session = session;
  holder.saver = saver;

  // load the existing text (the chapter may already be started)
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
    // the chapter is fixed for the screen's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pre-flight: mic permission, service, offline language; the nonce
  // allows rerunning it on request (the "Recheck" button)
  const [preflightNonce, setPreflightNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const checks = options.preflightChecks ?? createNativePreflightChecks();
    runPreflight(checks, options.lang)
      .then((report) => {
        if (!cancelled) setPreflight(report);
      })
      .catch(() => {
        // a pre-flight that blows up must not wall off the screen: proceed
        // without a result and let the engine report any real problem
        if (!cancelled) setPreflight({ ok: true, issues: [] });
      })
      .finally(() => {
        if (!cancelled) setPreflightRunning(false);
      });
    return () => {
      cancelled = true;
    };
    // checks and language are fixed for the screen's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflightNonce]);
  const rerunPreflight = useCallback(() => {
    setPreflightRunning(true);
    setPreflight(undefined);
    setPreflightNonce((nonce) => nonce + 1);
  }, []);

  // automatic pause when the app goes to background or the screen locks
  // (if not listening, still flush: never keep text only in RAM)
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

  // keep the screen on while listening (keep-awake)
  useEffect(() => {
    if (sessionState !== 'listening') return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [sessionState]);

  // screen close: stop (flush + engine down) and release resources
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
      // falls through: from idle we restart, folding in the previous session
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
        break; // committing: wait for the close
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
    pausedByInterruption: autoPauseReason !== undefined,
    autoPauseReason,
    reconnecting,
    preflight,
    preflightRunning,
    micDisabled,
    toggleMic,
    rerunPreflight,
  };
}
