// DictationEngine adapter over expo-speech-recognition: a THIN mapper from
// native events to the DictationEngine contract. NO policies here: the double
// `end` observed on the real engine is forwarded as-is (dedup belongs to
// DictationSession), and so is the restart at seams. Start options: continuous
// + interim results, on-device when the language is installed on the phone,
// otherwise the server recognizer.
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
> &
  Partial<
    Pick<
      typeof ExpoSpeechRecognitionModule,
      'supportsOnDeviceRecognition' | 'getSupportedLocales' | 'getPermissionsAsync'
    >
  >;

// the locale query must answer quickly: a missing native callback would
// otherwise hold every start, with the screen saying «listening» and no engine
export const LOCALE_QUERY_TIMEOUT_MS = 1_500;

// errors of the on-device recognizer that the server recognizer does not have:
// the language is marked as not on-device and the next start uses the server
const ON_DEVICE_FAILURES = new Set(['language-not-supported', 'service-not-allowed']);

// maps native code → dictation-domain error
const ERROR_MAP: Partial<Record<string, { code: DictationErrorCode; recoverable: boolean }>> = {
  // the mic/audio was lost or taken by others: the session pauses
  'audio-capture': { code: 'audio-interruption', recoverable: true },
  interrupted: { code: 'audio-interruption', recoverable: true },
  // transient (seen on a Galaxy A53 after a silence): the session restarts the
  // engine with a bounded backoff instead of pausing
  busy: { code: 'busy', recoverable: true },
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
  /** Per language: can it be recognized on the device (no server)? Asked once. */
  private readonly onDevice = new Map<string, Promise<boolean>>();
  /** Bumped by every start/stop: a start still preparing gives up if it changed. */
  private generation = 0;
  /** module.start() was called and its native start event has not come yet. */
  private startSent = false;
  /** The language of the running start, if it went on-device. */
  private onDeviceLang?: string;

  constructor(module: SpeechModule = ExpoSpeechRecognitionModule) {
    this.module = module;
    this.subscriptions = [
      this.module.addListener('start', () => {
        this.startSent = false;
        this.events.onStart?.();
      }),
      this.module.addListener('end', () => {
        this.startSent = false;
        this.events.onEnd?.();
      }),
      this.module.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
        const transcript = event.results?.[0]?.transcript;
        if (typeof transcript !== 'string' || transcript === '') return;
        if (event.isFinal) this.events.onFinal?.(transcript);
        else this.events.onPartial?.(transcript);
      }),
      this.module.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
        const lang = this.onDeviceLang;
        if (lang !== undefined && ON_DEVICE_FAILURES.has(event.error)) {
          // the on-device recognizer refused after all: server from now on, and a
          // transient error so the session restarts instead of failing
          this.onDevice.set(lang, Promise.resolve(false));
          this.onDeviceLang = undefined;
          this.events.onError?.({
            code: 'busy',
            recoverable: true,
            message: event.message || event.error,
            nativeCode: event.error,
          });
          return;
        }
        this.events.onError?.(mapError(event));
      }),
    ];
  }

  setEvents(events: DictationEngineEvents): void {
    this.events = events;
  }

  async start(options: DictationStartOptions): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    // ask only when not granted yet: on Android the request bounces the app to
    // the background for a moment even when the answer is already yes, and the
    // screen pauses dictation on background (Galaxy A53, 21 Oct: grey mic at once)
    const current = await this.module.getPermissionsAsync?.();
    const permission = current?.granted ? current : await this.module.requestPermissionsAsync();
    if (generation !== this.generation) return; // paused or left meanwhile
    if (!permission.granted) {
      this.events.onError?.({
        code: 'permission-denied',
        message: 'microphone/recognition permission denied',
        recoverable: false,
      });
      return;
    }
    // on-device when the language is installed: no server round trip, so no
    // «Server disconnected» (code 11) at every restart, and it works offline;
    // otherwise the server recognizer, as before
    const requiresOnDeviceRecognition = await this.canRecognizeOnDevice(options.lang);
    if (generation !== this.generation) return; // paused or left meanwhile
    this.onDeviceLang = requiresOnDeviceRecognition ? options.lang : undefined;
    this.startSent = true;
    this.module.start({
      lang: options.lang,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition,
      // punctuation comes only from the spoken commands: a recognizer that adds
      // its own clashes with them (a full stop glued to «virgola», capitals)
      addsPunctuation: false,
    });
  }

  cancelPendingStart(): void {
    this.generation += 1;
    // already sent to the recognizer but not confirmed: it must be stopped too
    if (this.startSent) {
      this.startSent = false;
      this.module.stop();
    }
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.module.stop();
  }

  private canRecognizeOnDevice(lang: string): Promise<boolean> {
    let known = this.onDevice.get(lang);
    if (known === undefined) {
      known = installedOnDevice(this.module, lang);
      this.onDevice.set(lang, known);
    }
    return known;
  }

  async pause(): Promise<void> {
    // native engines have no pause: a "gentle" stop that finalizes the results
    this.generation += 1;
    this.module.stop();
  }

  dispose(): void {
    this.generation += 1;
    this.module.stop();
    for (const sub of this.subscriptions) sub.remove();
    this.subscriptions = [];
  }
}

async function installedOnDevice(module: SpeechModule, lang: string): Promise<boolean> {
  try {
    if (module.supportsOnDeviceRecognition?.() !== true || !module.getSupportedLocales) {
      return false;
    }
    // the default recognizer: the one createOnDeviceSpeechRecognizer uses at start
    // (and the one the pre-flight check asks), not a specific service package
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LOCALE_QUERY_TIMEOUT_MS);
    });
    try {
      const answer = await Promise.race([module.getSupportedLocales({}), timeout]);
      return answer !== null && answer.installedLocales.includes(lang);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // old Android or no recognizer list: the server recognizer still works
    return false;
  }
}

function mapError(event: ExpoSpeechRecognitionErrorEvent): DictationError {
  const mapped = ERROR_MAP[event.error];
  return {
    code: mapped?.code ?? 'unknown',
    recoverable: mapped?.recoverable ?? false,
    message: event.message || event.error,
    nativeCode: event.error,
  };
}
