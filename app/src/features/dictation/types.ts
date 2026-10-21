// STT adapter contract: DictationEngine is a THIN mapper over the native
// engine's events. Session policies (automatic restart, dedup of the double
// `end`, pause on audio interruption) live in DictationSession, so they are
// covered by tests using the Fake engine.

export type DictationErrorCode =
  | 'permission-denied' // microphone/recognition permission denied
  | 'audio-interruption' // a phone call or another app took the microphone
  | 'no-speech' // prolonged silence: benign, the engine ends on its own
  | 'network' // cloud recognition cannot reach the network: transient, retried
  | 'busy' // the recognizer is still busy with the previous session: transient, retried
  | 'unknown';

export interface DictationError {
  code: DictationErrorCode;
  message?: string;
  /** true if the session can continue (pause/restart), false if it must stop */
  recoverable: boolean;
  /** Native error code as the recognizer sent it (diagnostics, never user text). */
  nativeCode?: string;
}

export interface DictationEngineEvents {
  /** Interim transcript, raw (no voice commands applied). */
  onPartial?(text: string): void;
  /** Block finalized by the engine, raw. */
  onFinal?(text: string): void;
  /** The engine is actually listening. */
  onStart?(): void;
  /**
   * The engine session has ended. WARNING: on Android this can fire TWICE
   * for the same stop. The adapter does NOT deduplicate, it forwards everything;
   * deduplication is the listener's job (DictationSession).
   */
  onEnd?(): void;
  onError?(error: DictationError): void;
}

export interface DictationStartOptions {
  /** BCP-47 language, e.g. 'it-IT'. */
  lang: string;
}

export interface DictationEngine {
  /** Where speech is recognized, for the dev test log (absent = unknown). */
  readonly recognizer?: 'on-device' | 'server';
  /** Starts a recognition session (continuous + interim results). */
  start(options: DictationStartOptions): Promise<void>;
  /** Stops listening, letting the last results finalize; onEnd follows. */
  stop(): Promise<void>;
  /**
   * Stops capture without closing the dictation session (a higher-level
   * concept). Native engines have no real pause: this is equivalent to
   * stop(); the distinction is semantic and exists for the caller.
   */
  pause(): Promise<void>;
  /** Registers the listeners (a single destination: the session). */
  setEvents(events: DictationEngineEvents): void;
  /** Releases resources (native subscriptions). */
  dispose(): void;
  /**
   * Gives up a start that is still being prepared (permission or locale query):
   * the recognizer must not start after a pause or a close that came meanwhile.
   */
  cancelPendingStart?(): void;
}
