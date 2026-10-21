// Galaxy A53, 21 Oct: the recognizer closes its session at every pause (end even
// with continuous: true); the session restarted it 150 ms later and Android
// answered «network: Server disconnected» (code 11) BEFORE confirming the start.
// The end that follows was taken for a duplicate, so dictation never resumed.
// A fake native recognizer drives the real adapter and the real session.

import { DictationSession, type DictationSessionEvent } from '../DictationSession';
import { ExpoDictationEngine, type SpeechModule } from '../engines/ExpoDictationEngine';

jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));

type Handler = (event: unknown) => void;

interface RecognizerOptions {
  /** Locales installed for on-device recognition (getSupportedLocales). */
  installed?: string[];
  onDevice?: boolean;
}

function fakeRecognizer(options: RecognizerOptions = {}) {
  const handlers: Record<string, Handler> = {};
  const recognizer = {
    starts: 0,
    /** The next N starts fail with code 11 before the native start event. */
    failingStarts: 0,
    /** Whether the native module sends `end` after such an error. */
    endAfterError: true,
    module: {
      start: jest.fn(() => {
        recognizer.starts += 1;
        if (recognizer.failingStarts > 0) {
          recognizer.failingStarts -= 1;
          handlers.error?.({ error: 'network', message: 'Server disconnected', code: 11 });
          if (recognizer.endAfterError) handlers.end?.(null);
          return;
        }
        handlers.start?.(null);
      }),
      stop: jest.fn(() => handlers.end?.(null)),
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
      addListener: jest.fn((name: string, handler: Handler) => {
        handlers[name] = handler;
        return { remove: jest.fn() };
      }),
      supportsOnDeviceRecognition: jest.fn(() => options.onDevice ?? true),
      getSupportedLocales: jest.fn(async () => ({
        locales: ['it-IT', 'en-US'],
        installedLocales: options.installed ?? [],
      })),
    },
    /** The recognizer closes its session at a pause, as on the phone. */
    endOfSpeech() {
      handlers.end?.(null);
    },
    speak(text: string) {
      handlers.result?.({ isFinal: true, results: [{ transcript: text }] });
    },
  };
  return recognizer;
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const advance = async (ms: number) => {
  jest.advanceTimersByTime(ms);
  await flush();
};

async function setup(options?: RecognizerOptions) {
  const recognizer = fakeRecognizer(options);
  const engine = new ExpoDictationEngine(recognizer.module as unknown as SpeechModule);
  const events: DictationSessionEvent[] = [];
  const session = new DictationSession({
    engine,
    onFlush: jest.fn(),
    lang: 'it-IT',
    onEvent: (e) => events.push(e),
  });
  session.start();
  await flush();
  return { recognizer, session, events };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Dictation restart after the recognizer ends (Galaxy A53, code 11)', () => {
  it('waits about half a second after an end before starting again', async () => {
    const { recognizer, session } = await setup();
    recognizer.speak('volevo dire che');
    recognizer.endOfSpeech();
    await advance(200);
    expect(recognizer.starts).toBe(1); // not straight away
    await advance(400);
    expect(recognizer.starts).toBe(2);
    expect(session.state).toBe('listening');
  });

  it('code 11 before the start is confirmed: reconnects and restarts by itself', async () => {
    const { recognizer, session } = await setup();
    recognizer.failingStarts = 1;
    recognizer.endOfSpeech();
    await advance(600); // the restart fails with code 11, then `end`
    expect(recognizer.starts).toBe(2);
    expect(session.reconnecting).toBe(true);
    expect(session.state).toBe('listening');
    await advance(600); // backoff 0.5 s
    expect(recognizer.starts).toBe(3);
    expect(session.reconnecting).toBe(false);
    recognizer.speak('sto dettando');
    expect(session.text).toBe('Sto dettando');
  });

  it('code 11 with no `end` after it: still restarts by itself', async () => {
    const { recognizer, session } = await setup();
    recognizer.failingStarts = 1;
    recognizer.endAfterError = false;
    recognizer.endOfSpeech();
    await advance(600);
    expect(recognizer.starts).toBe(2);
    await advance(600);
    expect(recognizer.starts).toBe(3);
    expect(session.state).toBe('listening');
  });

  it('after 5 failed restarts it pauses and says why', async () => {
    const { recognizer, session, events } = await setup();
    recognizer.failingStarts = 99;
    recognizer.endOfSpeech();
    await advance(600);
    for (let i = 0; i < 6; i += 1) await advance(2_100);
    expect(session.state).toBe('paused');
    expect(events).toContainEqual({ type: 'auto-pause', reason: 'engine-unavailable' });
    expect(recognizer.starts).toBe(1 + 1 + 5); // first start, the failed restart, 5 retries
  });
});

describe('On-device recognition when the language is installed', () => {
  it('uses the on-device recognizer for an installed language', async () => {
    const { recognizer } = await setup({ installed: ['it-IT', 'en-US'] });
    expect(recognizer.module.start).toHaveBeenCalledWith(
      expect.objectContaining({ lang: 'it-IT', requiresOnDeviceRecognition: true }),
    );
  });

  it('falls back to the server recognizer when the language is not installed', async () => {
    const { recognizer } = await setup({ installed: ['en-US'] });
    expect(recognizer.module.start).toHaveBeenCalledWith(
      expect.objectContaining({ requiresOnDeviceRecognition: false }),
    );
  });

  it('falls back to the server recognizer when the device has no on-device recognition', async () => {
    const { recognizer } = await setup({ installed: ['it-IT'], onDevice: false });
    expect(recognizer.module.start).toHaveBeenCalledWith(
      expect.objectContaining({ requiresOnDeviceRecognition: false }),
    );
  });
});

describe('Review follow-ups', () => {
  it('asks the default on-device recognizer for its installed locales (as the start uses)', async () => {
    const { recognizer } = await setup({ installed: ['it-IT'] });
    expect(recognizer.module.getSupportedLocales).toHaveBeenCalledWith({});
  });

  it('an on-device start error marks the language and retries with the server recognizer', async () => {
    const { recognizer, session } = await setup({ installed: ['it-IT'] });
    expect(recognizer.module.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ requiresOnDeviceRecognition: true }),
    );
    // the on-device recognizer refuses the language after all
    const errorHandler = recognizer.module.addListener.mock.calls.find(
      ([name]) => name === 'error',
    )?.[1] as (event: unknown) => void;
    errorHandler({ error: 'language-not-supported', message: 'not supported on device' });
    const endHandler = recognizer.module.addListener.mock.calls.find(
      ([name]) => name === 'end',
    )?.[1] as (event: unknown) => void;
    endHandler(null); // the native module always ends the session after an error
    await advance(600);
    expect(session.state).toBe('listening');
    expect(recognizer.module.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ requiresOnDeviceRecognition: false }),
    );
  });

  it('a locale query that never answers falls back to the server recognizer after a short wait', async () => {
    const recognizer = fakeRecognizer({ installed: ['it-IT'] });
    recognizer.module.getSupportedLocales.mockImplementation(() => new Promise(() => undefined));
    const engine = new ExpoDictationEngine(recognizer.module as unknown as SpeechModule);
    const session = new DictationSession({ engine, onFlush: jest.fn(), lang: 'it-IT' });
    session.start();
    await flush();
    expect(recognizer.module.start).not.toHaveBeenCalled();
    await advance(1_600);
    expect(recognizer.module.start).toHaveBeenCalledWith(
      expect.objectContaining({ requiresOnDeviceRecognition: false }),
    );
  });

  it('a pause while the start is still being prepared never starts the recognizer', async () => {
    const recognizer = fakeRecognizer({ installed: ['it-IT'] });
    recognizer.module.getSupportedLocales.mockImplementation(() => new Promise(() => undefined));
    const engine = new ExpoDictationEngine(recognizer.module as unknown as SpeechModule);
    const session = new DictationSession({ engine, onFlush: jest.fn(), lang: 'it-IT' });
    session.start();
    await flush();
    session.pause();
    await advance(2_000);
    expect(recognizer.module.start).not.toHaveBeenCalled();
  });

  it('a pause during the half-second wait after an end does not restart', async () => {
    const { recognizer, session } = await setup();
    recognizer.endOfSpeech();
    session.pause();
    await advance(1_000);
    expect(recognizer.starts).toBe(1);
    expect(session.state).toBe('paused');
  });

  it('disposing during the half-second wait does not restart and stops the recognizer', async () => {
    const { recognizer, session } = await setup();
    recognizer.endOfSpeech();
    session.dispose();
    await advance(1_000);
    expect(recognizer.starts).toBe(1);
    expect(recognizer.module.stop).toHaveBeenCalled();
  });
});

describe('Microphone permission already granted (Galaxy A53, 21 Oct)', () => {
  it('does not ask again: the request bounces the app to the background and paused dictation', async () => {
    const recognizer = fakeRecognizer();
    const module = {
      ...recognizer.module,
      getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
    };
    const engine = new ExpoDictationEngine(module as unknown as SpeechModule);
    const session = new DictationSession({ engine, onFlush: jest.fn(), lang: 'it-IT' });
    session.start();
    await flush();
    expect(module.getPermissionsAsync).toHaveBeenCalled();
    expect(module.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(recognizer.starts).toBe(1);
    expect(session.state).toBe('listening');
  });

  it('asks only when the permission is not granted yet', async () => {
    const recognizer = fakeRecognizer();
    const module = {
      ...recognizer.module,
      getPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
    };
    const engine = new ExpoDictationEngine(module as unknown as SpeechModule);
    const session = new DictationSession({ engine, onFlush: jest.fn(), lang: 'it-IT' });
    session.start();
    await flush();
    expect(module.requestPermissionsAsync).toHaveBeenCalled();
    expect(recognizer.starts).toBe(1);
  });
});

describe('Benign error after the session already ended (code 5, Galaxy A53)', () => {
  it('restarts by itself when `client` arrives after the end', async () => {
    const { recognizer, session } = await setup();
    const errorHandler = recognizer.module.addListener.mock.calls.find(
      ([name]) => name === 'error',
    )?.[1] as (event: unknown) => void;
    recognizer.speak('un gatto');
    recognizer.endOfSpeech(); // the session ended: a restart is planned
    errorHandler({ error: 'client', message: 'Other client side errors' }); // then code 5
    await advance(600);
    expect(recognizer.starts).toBe(2);
    expect(session.state).toBe('listening');
  });

  it('restarts by itself when `client` comes with no end at all', async () => {
    const { recognizer, session } = await setup();
    recognizer.failingStarts = 0;
    const errorHandler = recognizer.module.addListener.mock.calls.find(
      ([name]) => name === 'error',
    )?.[1] as (event: unknown) => void;
    recognizer.endOfSpeech();
    await advance(600); // restarted once
    const startsBefore = recognizer.starts;
    // the new session dies before confirming the start, with no `end`
    recognizer.module.start.mockImplementationOnce(() => {
      recognizer.starts += 1;
      errorHandler({ error: 'client', message: 'Other client side errors' });
    });
    recognizer.endOfSpeech();
    await advance(600);
    expect(recognizer.starts).toBe(startsBefore + 1);
    await advance(600);
    expect(recognizer.starts).toBe(startsBefore + 2);
    expect(session.state).toBe('listening');
  });
});

describe('Words heard but never finalized (Galaxy A53, 21 Oct)', () => {
  it('keeps the last interim result when the session dies with an error before its final', async () => {
    const { recognizer, session } = await setup();
    const handler = (name: string) =>
      recognizer.module.addListener.mock.calls.find(([n]) => n === name)?.[1] as (
        event: unknown,
      ) => void;
    recognizer.speak("L'uomo si sveglia in una navicella spaziale sconosciuta.");
    handler('result')({
      isFinal: false,
      results: [{ transcript: ' Pensa di essere al trecento avanti Cristo' }],
    });
    handler('error')({ error: 'client', message: 'Other client side errors' });
    expect(session.text).toBe(
      "L'uomo si sveglia in una navicella spaziale sconosciuta. Pensa di essere al trecento avanti Cristo",
    );
  });

  it('does not add an interim result twice once its final has arrived', async () => {
    const { recognizer, session } = await setup();
    const handler = (name: string) =>
      recognizer.module.addListener.mock.calls.find(([n]) => n === name)?.[1] as (
        event: unknown,
      ) => void;
    handler('result')({ isFinal: false, results: [{ transcript: 'un gatto' }] });
    recognizer.speak('un gatto');
    handler('error')({ error: 'client', message: 'Other client side errors' });
    expect(session.text).toBe('Un gatto');
  });
});

describe('Exact phone sequence at 14:43 (final → code 5 → native end)', () => {
  it('restarts by itself about half a second after the code 5', async () => {
    const { recognizer, session } = await setup();
    const handler = (name: string) =>
      recognizer.module.addListener.mock.calls.find(([n]) => n === name)?.[1] as (
        event: unknown,
      ) => void;
    recognizer.speak('E poi subito dopo uscì un serpente strisciante da sotto un tavolo.');
    handler('error')({ error: 'client', message: 'Other client side errors' });
    handler('end')(null); // the native end that follows the error
    await advance(600);
    expect(recognizer.starts).toBe(2);
    expect(session.state).toBe('listening');
  });
});

describe('Punctuation only from voice commands (Galaxy A53, 21 Oct)', () => {
  it('asks the recognizer not to add its own punctuation', async () => {
    const { recognizer } = await setup({ installed: ['it-IT'] });
    expect(recognizer.module.start).toHaveBeenCalledWith(
      expect.objectContaining({ addsPunctuation: false }),
    );
  });
});
