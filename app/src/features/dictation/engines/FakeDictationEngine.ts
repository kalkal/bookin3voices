// Motore finto per i test: implementa DictationEngine e si pilota in due modi.
//  1. Emissione manuale (emitFinal, emitEnd, ...) per test passo-passo.
//  2. Script con timing (playScript + jest fake timers) per sequenze realistiche.
// Riproduce anche i vizi osservati sul motore reale: `duplicateEnd` fa arrivare
// il doppio evento `end` a ogni chiusura della sessione motore.

import type {
  DictationEngine,
  DictationEngineEvents,
  DictationError,
  DictationStartOptions,
} from '../types';

export type FakeScriptStep = { atMs: number } & (
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'error'; error: DictationError }
);

export class FakeDictationEngine implements DictationEngine {
  readonly startCalls: DictationStartOptions[] = [];
  stopCalls = 0;
  pauseCalls = 0;
  disposed = false;

  /** Su start() emette subito onStart (come conferma del motore). */
  autoEmitStart = true;
  /** Su stop()/pause() emette onEnd, come i motori reali. */
  autoEmitEndOnStop = true;
  /** Vizio del motore reale: ogni chiusura emette DUE `end`. */
  duplicateEnd = false;

  private events: DictationEngineEvents = {};
  private timers: ReturnType<typeof setTimeout>[] = [];

  setEvents(events: DictationEngineEvents): void {
    this.events = events;
  }

  async start(options: DictationStartOptions): Promise<void> {
    this.startCalls.push(options);
    if (this.autoEmitStart) this.emitStart();
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    if (this.autoEmitEndOnStop) this.emitEnd();
  }

  async pause(): Promise<void> {
    this.pauseCalls += 1;
    if (this.autoEmitEndOnStop) this.emitEnd();
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  // --- pilotaggio manuale -------------------------------------------------

  emitStart(): void {
    this.events.onStart?.();
  }

  emitPartial(text: string): void {
    this.events.onPartial?.(text);
  }

  emitFinal(text: string): void {
    this.events.onFinal?.(text);
  }

  /** Emette `end` rispettando l'eventuale doppione configurato. */
  emitEnd(): void {
    this.events.onEnd?.();
    if (this.duplicateEnd) this.events.onEnd?.();
  }

  /** Emette un SOLO `end`, ignorando duplicateEnd (per casi mirati). */
  emitSingleEnd(): void {
    this.events.onEnd?.();
  }

  emitError(error: DictationError): void {
    this.events.onError?.(error);
  }

  // --- pilotaggio a script ------------------------------------------------

  /** Programma gli eventi con setTimeout: da usare con i fake timers di Jest. */
  playScript(steps: readonly FakeScriptStep[]): void {
    for (const step of steps) {
      const timer = setTimeout(() => {
        switch (step.type) {
          case 'partial':
            this.emitPartial(step.text);
            break;
          case 'final':
            this.emitFinal(step.text);
            break;
          case 'start':
            this.emitStart();
            break;
          case 'end':
            this.emitEnd();
            break;
          case 'error':
            this.emitError(step.error);
            break;
        }
      }, step.atMs);
      this.timers.push(timer);
    }
  }
}
