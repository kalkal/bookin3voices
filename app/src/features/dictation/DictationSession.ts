// Dictation session controller: binds any DictationEngine to the pure state
// machine (sessionMachine) and concentrates the dictation robustness policies:
//  - automatic restart of the engine session at seams (end while listening),
//    after a short wait (RESTART_DELAY_MS) so Android's recognizer has closed;
//  - DEDUP of the double `end` event (risk of a double restart);
//  - automatic pause + flush on a real audio interruption (call, other app)
//    or after ~2 minutes without speech; resuming is explicit only;
//  - transient recognizer errors (busy, network, «Server disconnected») restart
//    the engine with a bounded backoff instead of pausing, also when they come
//    before the engine confirmed its start; only when they never recover the
//    session pauses, saying why;
//  - flush on pause/stop/error and on request (background): dictated text
//    never lives only in RAM;
//  - restart-storm guard (an engine dying in a loop → error).
// Persistence is the caller's job (onFlush → repository).

import type { DictationEngine, DictationError } from './types';
import {
  transition,
  type SessionEffect,
  type SessionEventType,
  type SessionState,
} from './sessionMachine';
import { commandLanguage, dictationLocale } from './dictationLanguage';
import { TranscriptComposer } from './voiceCommands';

/** Why the session paused by itself (the user always resumes it). */
export type AutoPauseReason = 'audio-interruption' | 'engine-unavailable' | 'silence';

export type DictationSessionEvent =
  | { type: 'engine-restarted'; count: number }
  | { type: 'duplicate-end-ignored' }
  | { type: 'auto-pause'; reason: AutoPauseReason }
  | { type: 'engine-retry-scheduled'; attempt: number; delayMs: number }
  /** The engine is off waiting for a retry: the UI must not say «listening». */
  | { type: 'reconnecting'; active: boolean }
  | { type: 'engine-error'; error: DictationError }
  | { type: 'restart-storm' };

export interface DictationSessionOptions {
  engine: DictationEngine;
  /** Persists the accumulated text: called on pause/stop/error/flush(). */
  onFlush: (text: string) => void;
  /** Recognition locale (BCP-47); defaults to the interface language's (dictationLocale). */
  lang?: string;
  /** Apply spoken punctuation commands to final results (default true). */
  voiceCommands?: boolean;
  onStateChange?: (state: SessionState) => void;
  /** Raw interim result, UI only (ephemeral, never persisted). */
  onPartial?: (raw: string) => void;
  /** Accumulated text, updated after every final result. */
  onTextChange?: (text: string) => void;
  /** Lifecycle events for logging/UI diagnostics. */
  onEvent?: (event: DictationSessionEvent) => void;
}

// more than MAX_RESTARTS restarts within RESTART_WINDOW_MS = broken engine (e.g.
// offline without pre-flight): a clear error beats a silent restart loop.
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 10_000;

// transient errors (busy, network): one wait per attempt, then pause. Speech
// in between proves the engine works again and resets the count.
const TRANSIENT_BACKOFF_MS = [500, 1_000, 2_000, 2_000, 2_000] as const;

// after the recognizer ends a session (it does at every pause on Android, even
// with continuous: true) wait before starting again: an immediate restart while
// the previous connection is still closing gets «Server disconnected» (code 11)
export const RESTART_DELAY_MS = 500;

// no speech at all for this long while listening: pause (battery, privacy)
export const SILENCE_PAUSE_MS = 120_000;

export class DictationSession {
  private readonly engine: DictationEngine;
  private readonly options: DictationSessionOptions;
  private readonly composer: TranscriptComposer;
  private readonly locale: string;
  private currentState: SessionState = 'idle';
  private engineActive = false;
  private restartTimestamps: number[] = [];
  private restarts = 0;
  private lastError?: DictationError;
  private transientAttempts = 0;
  private pendingBackoffMs?: number;
  private backoffTimer?: ReturnType<typeof setTimeout>;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private isReconnecting = false;
  /** The latest interim result not yet confirmed by a final (kept if the session dies). */
  private pendingPartial = '';

  constructor(options: DictationSessionOptions) {
    this.options = options;
    this.locale = dictationLocale(options.lang);
    this.composer = new TranscriptComposer('', commandLanguage(this.locale));
    this.engine = options.engine;
    this.engine.setEvents({
      onStart: () => this.handleEngineStart(),
      onEnd: () => this.handleEngineEnd(),
      onPartial: (raw) => this.handlePartial(raw),
      onFinal: (raw) => this.handleFinal(raw),
      onError: (error) => this.handleEngineError(error),
    });
  }

  get state(): SessionState {
    return this.currentState;
  }

  get text(): string {
    return this.composer.value;
  }

  /** Engine session restarts since the last start (diagnostics/UI). */
  get restartCount(): number {
    return this.restarts;
  }

  get error(): DictationError | undefined {
    return this.lastError;
  }

  /** Listening, but the engine is off waiting for a retry after busy/network. */
  get reconnecting(): boolean {
    return this.isReconnecting;
  }

  /** Starts from idle (buffer cleared) or resumes from paused (buffer kept). */
  start(): void {
    this.dispatch('USER_START');
  }

  pause(): void {
    this.dispatch('USER_PAUSE');
  }

  stop(): void {
    this.dispatch('USER_STOP');
  }

  /** From error back to idle, ready for a new dictation. */
  reset(): void {
    this.lastError = undefined;
    this.dispatch('RESET');
  }

  /** Explicit flush (e.g. moving to background): persists the current text. */
  flush(): void {
    this.options.onFlush(this.composer.value);
  }

  dispose(): void {
    this.clearTimers();
    this.engine.dispose();
  }

  private dispatch(event: SessionEventType): void {
    const result = transition(this.currentState, event);
    if (result.ignored) return;
    const changed = result.to !== this.currentState;
    this.currentState = result.to;
    if (result.to !== 'listening') this.clearTimers();
    if (changed) this.options.onStateChange?.(result.to);
    for (const effect of result.effects) this.runEffect(effect);
    this.maybeFinishCommit();
  }

  private runEffect(effect: SessionEffect): void {
    switch (effect) {
      case 'resetTranscript':
        this.composer.reset();
        this.restarts = 0;
        this.restartTimestamps = [];
        this.lastError = undefined;
        break;
      case 'startEngine':
        // an explicit start/resume: fresh retry budget and silence window
        this.transientAttempts = 0;
        this.pendingBackoffMs = undefined;
        this.armSilenceTimer();
        this.startEngine();
        break;
      case 'restartEngine':
        this.restartEngine();
        break;
      case 'stopEngine':
        if (this.engineActive) {
          this.engine.stop().catch(() => {
            // a failing stop must not block pause/close
          });
        } else {
          // a start may still be preparing: it must not go ahead after this
          this.engine.cancelPendingStart?.();
        }
        break;
      case 'flush':
        this.flush();
        break;
    }
  }

  private startEngine(): void {
    this.engine.start({ lang: this.locale }).catch(() => {
      this.fail({ code: 'unknown', message: 'engine start failed', recoverable: false });
    });
  }

  private restartEngine(): void {
    if (this.pendingBackoffMs !== undefined) {
      // after a transient error: wait before restarting, outside the storm guard
      const delayMs = this.pendingBackoffMs;
      this.pendingBackoffMs = undefined;
      if (this.backoffTimer !== undefined) clearTimeout(this.backoffTimer);
      this.backoffTimer = setTimeout(() => {
        this.backoffTimer = undefined;
        if (this.currentState !== 'listening') return;
        this.restarts += 1;
        this.options.onEvent?.({ type: 'engine-restarted', count: this.restarts });
        this.startEngine();
      }, delayMs);
      return;
    }
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
    this.restartTimestamps.push(now);
    if (this.restartTimestamps.length > MAX_RESTARTS) {
      this.options.onEvent?.({ type: 'restart-storm' });
      this.fail({
        code: 'unknown',
        message: `engine ended ${this.restartTimestamps.length} times in ${RESTART_WINDOW_MS / 1000}s`,
        recoverable: false,
      });
      return;
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.currentState !== 'listening') return;
      this.restarts += 1;
      this.options.onEvent?.({ type: 'engine-restarted', count: this.restarts });
      this.startEngine();
    }, RESTART_DELAY_MS);
  }

  /**
   * Retry after a transient error that came while the engine was NOT running
   * (it failed before confirming the start): no end will restart it, and the
   * one that may follow is taken for a duplicate, so the retry starts from here.
   */
  private scheduleRetry(): void {
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    this.restartEngine();
  }

  private handleEngineStart(): void {
    this.engineActive = true;
    this.setReconnecting(false);
  }

  private setReconnecting(active: boolean): void {
    if (this.isReconnecting === active) return;
    this.isReconnecting = active;
    this.options.onEvent?.({ type: 'reconnecting', active });
  }

  private handleEngineEnd(): void {
    // DEDUP: a single ENGINE_ENDED per engine session; duplicates arriving
    // before the next onStart are ignored (no double restart).
    if (!this.engineActive) {
      this.options.onEvent?.({ type: 'duplicate-end-ignored' });
      return;
    }
    this.engineActive = false;
    this.dispatch('ENGINE_ENDED');
  }

  private handlePartial(raw: string): void {
    if (this.currentState !== 'listening') return;
    this.pendingPartial = raw;
    this.heardSpeech();
    this.options.onPartial?.(raw);
  }

  /** The engine produced speech: it works, and the user is still dictating. */
  private heardSpeech(): void {
    this.transientAttempts = 0;
    this.armSilenceTimer();
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer !== undefined) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = undefined;
      if (this.currentState === 'listening') this.autoPause('silence');
    }, SILENCE_PAUSE_MS);
  }

  private clearTimers(): void {
    if (this.silenceTimer !== undefined) clearTimeout(this.silenceTimer);
    if (this.backoffTimer !== undefined) clearTimeout(this.backoffTimer);
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer);
    this.silenceTimer = undefined;
    this.backoffTimer = undefined;
    this.restartTimer = undefined;
    this.pendingBackoffMs = undefined;
    this.setReconnecting(false);
  }

  private autoPause(reason: AutoPauseReason): void {
    // flush + engine down; resumes only on the user's choice
    this.options.onEvent?.({ type: 'auto-pause', reason });
    this.dispatch('AUDIO_INTERRUPTED');
  }

  private handleFinal(raw: string): void {
    // finals are accepted in paused/committing too: the engine may
    // finalize the last block AFTER the stop, and it must never be lost
    if (this.currentState === 'idle' || this.currentState === 'error') return;
    this.pendingPartial = '';
    if (!raw.trim()) return;
    if (this.currentState === 'listening') this.heardSpeech();
    const text =
      this.options.voiceCommands === false
        ? this.composer.appendVerbatim(raw)
        : this.composer.append(raw);
    this.options.onTextChange?.(text);
    if (this.currentState !== 'listening') {
      // the pause/stop flush has already run: persist this late arrival too
      this.flush();
    }
  }

  private handleEngineError(error: DictationError): void {
    this.options.onEvent?.({ type: 'engine-error', error });
    // the recognizer may die before turning what it heard into a final (Galaxy
    // A53: code 5 after a long interim): keep those words instead of losing them
    if (this.pendingPartial.trim() !== '') {
      const heard = this.pendingPartial;
      this.pendingPartial = '';
      this.handleFinal(heard);
    }
    if (!error.recoverable) {
      this.fail(error);
      return;
    }
    if (this.currentState !== 'listening') return;
    if (error.code === 'audio-interruption') {
      // a call or another app has the microphone: restarting would fight it
      this.autoPause('audio-interruption');
      return;
    }
    if (error.code === 'busy' || error.code === 'network') {
      const delayMs = TRANSIENT_BACKOFF_MS[this.transientAttempts];
      if (delayMs === undefined) {
        this.autoPause('engine-unavailable');
        return;
      }
      this.transientAttempts += 1;
      this.pendingBackoffMs = delayMs;
      this.setReconnecting(true);
      this.options.onEvent?.({
        type: 'engine-retry-scheduled',
        attempt: this.transientAttempts,
        delayMs,
      });
      // failed before confirming the start: retry from here (an end won't come,
      // or will be ignored as a duplicate); a running engine retries on its end
      if (!this.engineActive) this.scheduleRetry();
      return;
    }
    // 'no-speech', 'client' and similar: benign. The recognizer session is over,
    // but its `end` does not always follow (Galaxy A53: code 5 with no end), so
    // the error itself counts as the end; a late `end` is then ignored as a
    // duplicate. If a restart is already planned, nothing more to do.
    if (this.engineActive) {
      this.engineActive = false;
      this.dispatch('ENGINE_ENDED');
    } else if (this.restartTimer === undefined && this.backoffTimer === undefined) {
      this.restartEngine();
    }
  }

  private fail(error: DictationError): void {
    this.lastError = error;
    this.dispatch('FATAL_ERROR');
  }

  private maybeFinishCommit(): void {
    if (this.currentState === 'committing' && !this.engineActive) {
      this.dispatch('COMMIT_DONE');
    }
  }
}
