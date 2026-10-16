// Controller della sessione di dettatura: lega un DictationEngine qualsiasi
// alla state machine pura (sessionMachine) e vi concentra le politiche emerse
// dalle regole di robustezza della dettatura:
//  - riavvio automatico della sessione motore ai giunti (end mentre si ascolta);
//  - DEDUP del doppio evento `end` (rischio doppio riavvio);
//  - pausa automatica + flush su interruzione audio; la ripresa è solo esplicita;
//  - flush su pausa/stop/errore e su richiesta (background): il testo dettato
//    non vive mai solo in RAM (regola di convivenza 3);
//  - guardia anti-tempesta di riavvii (motore che muore in loop → errore).
// La persistenza è del chiamante (onFlush → repository).

import type { DictationEngine, DictationError } from './types';
import {
  transition,
  type SessionEffect,
  type SessionEventType,
  type SessionState,
} from './sessionMachine';
import { TranscriptComposer } from './voiceCommands';

export type DictationSessionEvent =
  | { type: 'engine-restarted'; count: number }
  | { type: 'duplicate-end-ignored' }
  | { type: 'audio-interruption'; error: DictationError }
  | { type: 'engine-error'; error: DictationError }
  | { type: 'restart-storm' };

export interface DictationSessionOptions {
  engine: DictationEngine;
  /** Persistenza del testo accumulato: chiamata su pausa/stop/errore/flush(). */
  onFlush: (text: string) => void;
  /** Lingua del riconoscimento; default it-IT. */
  lang?: string;
  /** Applicare i comandi vocali di punteggiatura ai finali (default true). */
  voiceCommands?: boolean;
  onStateChange?: (state: SessionState) => void;
  /** Parziale grezzo, solo per la UI (effimero, mai persistito). */
  onPartial?: (raw: string) => void;
  /** Testo accumulato aggiornato dopo ogni finale. */
  onTextChange?: (text: string) => void;
  /** Eventi di ciclo vita per log/diagnostica UI. */
  onEvent?: (event: DictationSessionEvent) => void;
}

// più di MAX_RESTARTS riavvii in RESTART_WINDOW_MS = motore rotto (es. offline
// senza pre-flight): meglio un errore chiaro che un loop silenzioso di riavvii.
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 10_000;

export class DictationSession {
  private readonly engine: DictationEngine;
  private readonly options: DictationSessionOptions;
  private readonly composer = new TranscriptComposer();
  private currentState: SessionState = 'idle';
  private engineActive = false;
  private restartTimestamps: number[] = [];
  private restarts = 0;
  private lastError?: DictationError;

  constructor(options: DictationSessionOptions) {
    this.options = options;
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

  /** Riavvii della sessione motore dall'ultimo start (diagnostica/UI). */
  get restartCount(): number {
    return this.restarts;
  }

  get error(): DictationError | undefined {
    return this.lastError;
  }

  /** Avvia da idle (buffer azzerato) o riprende da paused (buffer conservato). */
  start(): void {
    this.dispatch('USER_START');
  }

  pause(): void {
    this.dispatch('USER_PAUSE');
  }

  stop(): void {
    this.dispatch('USER_STOP');
  }

  /** Da error a idle, pronta per una nuova dettatura. */
  reset(): void {
    this.lastError = undefined;
    this.dispatch('RESET');
  }

  /** Flush esplicito (es. passaggio in background): persiste il testo corrente. */
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
            // lo stop che fallisce non deve bloccare pausa/chiusura
          });
        }
        break;
      case 'flush':
        this.flush();
        break;
    }
  }

  private startEngine(): void {
    this.engine.start({ lang: this.options.lang ?? 'it-IT' }).catch(() => {
      this.fail({ code: 'unknown', message: 'avvio del motore fallito', recoverable: false });
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
        message: `motore terminato ${this.restartTimestamps.length} volte in ${RESTART_WINDOW_MS / 1000}s`,
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
    // DEDUP: un solo ENGINE_ENDED per sessione motore; i doppioni
    // arrivati prima del prossimo onStart vengono ignorati (no doppio riavvio).
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
    // i finali si accettano anche in paused/committing: il motore può
    // consolidare l'ultimo blocco DOPO lo stop, e non va mai perso
    if (this.currentState === 'idle' || this.currentState === 'error') return;
    if (!raw.trim()) return;
    const text =
      this.options.voiceCommands === false
        ? this.composer.appendVerbatim(raw)
        : this.composer.append(raw);
    this.options.onTextChange?.(text);
    if (this.currentState !== 'listening') {
      // il flush di pausa/stop è già passato: persisti anche questo ritardatario
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
      // pausa automatica + flush; si riparte solo su scelta dell'utente
      this.options.onEvent?.({ type: 'audio-interruption', error });
      this.dispatch('AUDIO_INTERRUPTED');
    }
    // 'no-speech' e simili: benigni, seguirà onEnd → riavvio automatico
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
