// Dictation session controller: binds any DictationEngine to the pure state
// machine (sessionMachine) and concentrates the dictation robustness policies:
//  - automatic restart of the engine session at seams (end while listening);
//  - DEDUP of the double `end` event (risk of a double restart);
//  - automatic pause + flush on audio interruption; resuming is explicit only;
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

export type DictationSessionEvent =
  | { type: 'engine-restarted'; count: number }
  | { type: 'duplicate-end-ignored' }
  | { type: 'audio-interruption'; error: DictationError }
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
    this.engine.dispose();
  }

  private dispatch(event: SessionEventType): void {
    const result = transition(this.currentState, event);
    if (result.ignored) return;
    const changed = result.to !== this.currentState;
    this.currentState = result.to;
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
    this.restarts += 1;
    this.options.onEvent?.({ type: 'engine-restarted', count: this.restarts });
    this.startEngine();
  }

  private handleEngineStart(): void {
    this.engineActive = true;
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
    this.options.onPartial?.(raw);
  }

  private handleFinal(raw: string): void {
    // finals are accepted in paused/committing too: the engine may
    // finalize the last block AFTER the stop, and it must never be lost
    if (this.currentState === 'idle' || this.currentState === 'error') return;
    if (!raw.trim()) return;
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
    if (!error.recoverable) {
      this.fail(error);
      return;
    }
    if (error.code === 'audio-interruption' || error.code === 'network') {
      // automatic pause + flush; resumes only on the user's choice
      this.options.onEvent?.({ type: 'audio-interruption', error });
      this.dispatch('AUDIO_INTERRUPTED');
    }
    // 'no-speech' and similar: benign, onEnd follows → automatic restart
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
