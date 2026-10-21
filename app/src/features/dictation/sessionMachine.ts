// PURE state machine for the dictation session:
// idle → listening → paused → committing → error, with an explicit transition
// table. No side effects here: transition() declares the effects to run and
// DictationSession interprets them. Events not expected in the current state
// are explicitly ignored (ignored: true).

export type SessionState = 'idle' | 'listening' | 'paused' | 'committing' | 'error';

export type SessionEventType =
  | 'USER_START' // EXPLICIT user start or resume (never automatic)
  | 'USER_PAUSE'
  | 'USER_STOP'
  | 'ENGINE_ENDED' // engine session end, ALREADY deduplicated by DictationSession
  | 'AUDIO_INTERRUPTED' // automatic pause + flush (call/mic lost, long silence, engine down)
  | 'COMMIT_DONE'
  | 'FATAL_ERROR'
  | 'RESET';

export type SessionEffect =
  | 'resetTranscript' // new dictation from idle: the buffer starts empty
  | 'startEngine'
  | 'restartEngine' // automatic restart of the engine session
  | 'stopEngine'
  | 'flush'; // never lose text (text must never live only in RAM)

export interface Transition {
  to: SessionState;
  effects: readonly SessionEffect[];
  /** true if the event was not expected in the source state (no effects). */
  ignored: boolean;
}

const TABLE: Readonly<
  Record<
    SessionState,
    Partial<Record<SessionEventType, { to: SessionState; effects: readonly SessionEffect[] }>>
  >
> = {
  idle: {
    USER_START: { to: 'listening', effects: ['resetTranscript', 'startEngine'] },
  },
  listening: {
    USER_PAUSE: { to: 'paused', effects: ['flush', 'stopEngine'] },
    AUDIO_INTERRUPTED: { to: 'paused', effects: ['flush', 'stopEngine'] },
    ENGINE_ENDED: { to: 'listening', effects: ['restartEngine'] },
    USER_STOP: { to: 'committing', effects: ['flush', 'stopEngine'] },
  },
  paused: {
    // resuming is always the user's choice; the buffer is NOT cleared
    USER_START: { to: 'listening', effects: ['startEngine'] },
    USER_STOP: { to: 'committing', effects: ['flush'] },
  },
  committing: {
    // while closing, the engine may still emit end: no restart
    ENGINE_ENDED: { to: 'committing', effects: [] },
    COMMIT_DONE: { to: 'idle', effects: [] },
  },
  error: {
    RESET: { to: 'idle', effects: [] },
  },
};

export function transition(state: SessionState, event: SessionEventType): Transition {
  // fatal error: from any state (except error) everything stops, but we still
  // flush, so dictated text is not lost even on error
  if (event === 'FATAL_ERROR') {
    if (state === 'error') return { to: 'error', effects: [], ignored: true };
    return { to: 'error', effects: ['flush', 'stopEngine'], ignored: false };
  }
  const found = TABLE[state][event];
  if (!found) return { to: state, effects: [], ignored: true };
  return { to: found.to, effects: found.effects, ignored: false };
}
