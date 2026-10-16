// Fake engine for tests: implements DictationEngine and is driven in two ways.
//  1. Manual emission (emitFinal, emitEnd, ...) for step-by-step tests.
//  2. Timed scripts (playScript + jest fake timers) for realistic sequences.
// It also reproduces quirks observed on the real engine: `duplicateEnd` makes
// the double `end` event arrive on every engine session close.

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

  /** On start() emits onStart right away (as the engine's confirmation). */
  autoEmitStart = true;
  /** On stop()/pause() emits onEnd, like real engines. */
  autoEmitEndOnStop = true;
  /** Real-engine quirk: every close emits TWO `end` events. */
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

  // --- manual driving -------------------------------------------------

  emitStart(): void {
    this.events.onStart?.();
  }

  emitPartial(text: string): void {
    this.events.onPartial?.(text);
  }

  emitFinal(text: string): void {
    this.events.onFinal?.(text);
  }

  /** Emits `end`, honoring the configured duplicate, if any. */
  emitEnd(): void {
    this.events.onEnd?.();
    if (this.duplicateEnd) this.events.onEnd?.();
  }

  /** Emits a SINGLE `end`, ignoring duplicateEnd (for targeted cases). */
  emitSingleEnd(): void {
    this.events.onEnd?.();
  }

  emitError(error: DictationError): void {
    this.events.onError?.(error);
  }

  // --- script driving ------------------------------------------------

  /** Schedules events with setTimeout: use with Jest fake timers. */
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
