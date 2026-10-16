// DictationEngine adapter over expo-speech-recognition: a THIN mapper from
// native events to the DictationEngine contract. NO policies here: the double
// `end` observed on the real engine is forwarded as-is (dedup belongs to
// DictationSession), and so is the restart at seams. Start options are
// identical to the proven ones (continuous + interim results, cloud).
// NB: native module → any change here requires an EAS build; OTA is not enough.

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

/** Subset of the native module used by the adapter, injectable in tests. */
export type SpeechModule = Pick<
  typeof ExpoSpeechRecognitionModule,
  'start' | 'stop' | 'requestPermissionsAsync' | 'addListener'
>;

// maps native code → dictation-domain error
const ERROR_MAP: Partial<Record<string, { code: DictationErrorCode; recoverable: boolean }>> = {
  // the mic/audio was lost or taken by others: the session pauses
  'audio-capture': { code: 'audio-interruption', recoverable: true },
  interrupted: { code: 'audio-interruption', recoverable: true },
  busy: { code: 'audio-interruption', recoverable: true },
  // no network for cloud recognition: pause, not a restart loop
  network: { code: 'network', recoverable: true },
  // benign: the engine ends on its own and the session restarts it
  'no-speech': { code: 'no-speech', recoverable: true },
  'speech-timeout': { code: 'no-speech', recoverable: true },
  aborted: { code: 'no-speech', recoverable: true },
  client: { code: 'no-speech', recoverable: true },
  // fatal
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
        message: 'microphone/recognition permission denied',
        recoverable: false,
      });
      return;
    }
    // same options validated in testing (addsPunctuation is on-device only:
    // harmless on cloud, useful where supported)
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
    // native engines have no pause: a "gentle" stop that finalizes the results
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
