// Adapter DictationEngine su expo-speech-recognition: mapper SOTTILE
// degli eventi nativi verso il contratto DictationEngine. Qui NIENTE politiche:
// il doppio `end` osservato sul motore reale viene inoltrato tale e quale (la
// dedup è di DictationSession), il riavvio ai giunti pure. Opzioni di start
// identiche a quelle collaudate (continuous + parziali, cloud).
// NB: modulo nativo → ogni modifica qui richiede una build EAS, non basta l'OTA.

import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

import type {
  DictationEngine,
  DictationEngineEvents,
  DictationError,
  DictationErrorCode,
  DictationStartOptions,
} from '../types';

/** Sottoinsieme del modulo nativo usato dall'adapter, iniettabile nei test. */
export type SpeechModule = Pick<
  typeof ExpoSpeechRecognitionModule,
  'start' | 'stop' | 'requestPermissionsAsync' | 'addListener'
>;

// mappa codice nativo → errore del dominio dettatura
const ERROR_MAP: Partial<Record<string, { code: DictationErrorCode; recoverable: boolean }>> = {
  // il microfono/audio è stato perso o preso da altri: la sessione va in pausa
  'audio-capture': { code: 'audio-interruption', recoverable: true },
  interrupted: { code: 'audio-interruption', recoverable: true },
  busy: { code: 'audio-interruption', recoverable: true },
  // rete assente per il riconoscimento cloud: pausa, non loop di riavvii
  network: { code: 'network', recoverable: true },
  // benigni: il motore termina da solo e la sessione lo riavvia
  'no-speech': { code: 'no-speech', recoverable: true },
  'speech-timeout': { code: 'no-speech', recoverable: true },
  aborted: { code: 'no-speech', recoverable: true },
  client: { code: 'no-speech', recoverable: true },
  // fatali
  'not-allowed': { code: 'permission-denied', recoverable: false },
  'service-not-allowed': { code: 'permission-denied', recoverable: false },
};

export class ExpoDictationEngine implements DictationEngine {
  private readonly module: SpeechModule;
  private events: DictationEngineEvents = {};
  private subscriptions: { remove(): void }[] = [];

  constructor(module: SpeechModule = ExpoSpeechRecognitionModule) {
    this.module = module;
    this.subscriptions = [
      this.module.addListener('start', () => this.events.onStart?.()),
      this.module.addListener('end', () => this.events.onEnd?.()),
      this.module.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
        const transcript = event.results?.[0]?.transcript;
        if (typeof transcript !== 'string' || transcript === '') return;
        if (event.isFinal) this.events.onFinal?.(transcript);
        else this.events.onPartial?.(transcript);
      }),
      this.module.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
        this.events.onError?.(mapError(event));
      }),
    ];
  }

  setEvents(events: DictationEngineEvents): void {
    this.events = events;
  }

  async start(options: DictationStartOptions): Promise<void> {
    const permission = await this.module.requestPermissionsAsync();
    if (!permission.granted) {
      this.events.onError?.({
        code: 'permission-denied',
        message: 'permesso microfono/riconoscimento negato',
        recoverable: false,
      });
      return;
    }
    // stesse opzioni validate in prova (addsPunctuation è on-device only:
    // innocuo sul cloud, utile dove supportato)
    this.module.start({
      lang: options.lang,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
      addsPunctuation: true,
    });
  }

  async stop(): Promise<void> {
    this.module.stop();
  }

  async pause(): Promise<void> {
    // i motori nativi non hanno pausa: stop "gentile" che consolida i finali
    this.module.stop();
  }

  dispose(): void {
    for (const sub of this.subscriptions) sub.remove();
    this.subscriptions = [];
  }
}

function mapError(event: ExpoSpeechRecognitionErrorEvent): DictationError {
  const mapped = ERROR_MAP[event.error];
  return {
    code: mapped?.code ?? 'unknown',
    recoverable: mapped?.recoverable ?? false,
    message: event.message || event.error,
  };
}
