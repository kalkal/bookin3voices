// State machine PURA della sessione di dettatura:
// idle → listening → paused → committing → error, con tabella di transizioni
// esplicita. Nessun side effect qui: la funzione transition() dichiara gli
// effetti da eseguire e DictationSession li interpreta. Gli eventi non previsti
// per lo stato corrente vengono ignorati esplicitamente (ignored: true).

export type SessionState = 'idle' | 'listening' | 'paused' | 'committing' | 'error';

export type SessionEventType =
  | 'USER_START' // avvio o ripresa ESPLICITA dell'utente (mai automatica)
  | 'USER_PAUSE'
  | 'USER_STOP'
  | 'ENGINE_ENDED' // fine sessione motore, GIÀ deduplicata da DictationSession
  | 'AUDIO_INTERRUPTED' // telefonata/mic perso/rete giù → pausa automatica + flush
  | 'COMMIT_DONE'
  | 'FATAL_ERROR'
  | 'RESET';

export type SessionEffect =
  | 'resetTranscript' // nuova dettatura da idle: il buffer riparte vuoto
  | 'startEngine'
  | 'restartEngine' // giunto: riavvio automatico della sessione motore
  | 'stopEngine'
  | 'flush'; // mai perdere testo (regola di convivenza 3)

export interface Transition {
  to: SessionState;
  effects: readonly SessionEffect[];
  /** true se l'evento non era previsto nello stato di partenza (nessun effetto). */
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
    // la ripresa è sempre una scelta dell'utente; il buffer NON si azzera
    USER_START: { to: 'listening', effects: ['startEngine'] },
    USER_STOP: { to: 'committing', effects: ['flush'] },
  },
  committing: {
    // in chiusura il motore può ancora emettere end: nessun riavvio
    ENGINE_ENDED: { to: 'committing', effects: [] },
    COMMIT_DONE: { to: 'idle', effects: [] },
  },
  error: {
    RESET: { to: 'idle', effects: [] },
  },
};

export function transition(state: SessionState, event: SessionEventType): Transition {
  // errore fatale: da qualunque stato (tranne error) si ferma tutto, ma si
  // flusha comunque — il testo dettato non si perde nemmeno su errore
  if (event === 'FATAL_ERROR') {
    if (state === 'error') return { to: 'error', effects: [], ignored: true };
    return { to: 'error', effects: ['flush', 'stopEngine'], ignored: false };
  }
  const found = TABLE[state][event];
  if (!found) return { to: state, effects: [], ignored: true };
  return { to: found.to, effects: found.effects, ignored: false };
}
