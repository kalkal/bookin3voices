// Contratto dell'adapter STT: DictationEngine è un mapper SOTTILE
// sugli eventi del motore nativo. Le politiche di sessione — riavvio automatico,
// dedup del doppio `end`, pausa su interruzione audio —
// vivono in DictationSession, così sono coperte dai test con il Fake.

export type DictationErrorCode =
  | 'permission-denied' // permesso microfono/riconoscimento negato
  | 'audio-interruption' // telefonata o altra app ha preso il microfono
  | 'no-speech' // silenzio prolungato: benigno, il motore termina da solo
  | 'network' // il riconoscimento cloud non raggiunge la rete
  | 'unknown';

export interface DictationError {
  code: DictationErrorCode;
  message?: string;
  /** true se la sessione può proseguire (pausa/riavvio), false se deve fermarsi */
  recoverable: boolean;
}

export interface DictationEngineEvents {
  /** Trascritto provvisorio, grezzo (nessun comando vocale applicato). */
  onPartial?(text: string): void;
  /** Blocco consolidato dal motore, grezzo. */
  onFinal?(text: string): void;
  /** Il motore è effettivamente in ascolto. */
  onStart?(): void;
  /**
   * La sessione del motore è terminata. ATTENZIONE: su
   * Android può arrivare DUE volte per lo stesso stop — l'adapter NON deduplica,
   * inoltra tutto; la dedup è responsabilità di chi ascolta (DictationSession).
   */
  onEnd?(): void;
  onError?(error: DictationError): void;
}

export interface DictationStartOptions {
  /** Lingua BCP-47, es. 'it-IT'. */
  lang: string;
}

export interface DictationEngine {
  /** Avvia una sessione di riconoscimento (continuous + parziali). */
  start(options: DictationStartOptions): Promise<void>;
  /** Ferma l'ascolto lasciando consolidare gli ultimi risultati; seguirà onEnd. */
  stop(): Promise<void>;
  /**
   * Ferma la cattura senza chiudere la sessione di dettatura (concetto del
   * livello superiore). I motori nativi non hanno una vera pausa: equivale a
   * stop(), la distinzione è semantica ed esiste per il chiamante.
   */
  pause(): Promise<void>;
  /** Registra i listener (una sola destinazione: la sessione). */
  setEvents(events: DictationEngineEvents): void;
  /** Rilascia le risorse (subscription native). */
  dispose(): void;
}
