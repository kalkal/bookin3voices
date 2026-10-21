// Galaxy A53 report: dictation paused by itself («In pausa automatica (audio
// interrotto)») after a silence. Here a fake NATIVE recognizer drives the real
// adapter (ExpoDictationEngine) and the real session, so the native error codes
// go through the same mapping and policy as on the phone.

import { DictationSession, type DictationSessionEvent } from '../DictationSession';
import { ExpoDictationEngine, type SpeechModule } from '../engines/ExpoDictationEngine';
import type { SessionState } from '../sessionMachine';

jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));

type Handler = (event: unknown) => void;

/** Fake native recognizer: emits the events expo-speech-recognition emits. */
function fakeRecognizer() {
  const handlers: Record<string, Handler> = {};
  const recognizer = {
    starts: 0,
    module: {
      start: jest.fn(() => {
        recognizer.starts += 1;
        handlers.start?.(null);
      }),
      stop: jest.fn(() => handlers.end?.(null)),
      requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
      addListener: jest.fn((name: string, handler: Handler) => {
        handlers[name] = handler;
        return { remove: jest.fn() };
      }),
    },
    /** A native error, followed by the `end` the engine always sends after it. */
    fail(code: string) {
      handlers.error?.({ error: code, message: `native ${code}` });
      handlers.end?.(null);
    },
    speak(text: string) {
      handlers.result?.({ isFinal: true, results: [{ transcript: text }] });
    },
  };
  return recognizer;
}

async function setup() {
  const recognizer = fakeRecognizer();
  const engine = new ExpoDictationEngine(recognizer.module as unknown as SpeechModule);
  const onFlush = jest.fn<void, [string]>();
  const states: SessionState[] = [];
  const events: DictationSessionEvent[] = [];
  const session = new DictationSession({
    engine,
    onFlush,
    lang: 'it-IT',
    onStateChange: (s) => states.push(s),
    onEvent: (e) => events.push(e),
  });
  session.start();
  await flush();
  return { recognizer, session, onFlush, states, events };
}

/** Lets the adapter's awaited permission request resolve. */
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const advance = async (ms: number) => {
  jest.advanceTimersByTime(ms);
  await flush();
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Dictation on a flaky recognizer (Galaxy A53)', () => {
  it('busy: no pause, the engine restarts by itself after a short wait', async () => {
    const { recognizer, session, events } = await setup();
    recognizer.speak('prima frase');
    recognizer.fail('busy');
    expect(session.state).toBe('listening');
    expect(recognizer.starts).toBe(1); // not hammered right away: backoff
    await advance(1000);
    expect(recognizer.starts).toBe(2);
    expect(session.state).toBe('listening');
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'auto-pause' }));
  });

  it('during the wait the session says it is reconnecting, once, until the engine is back', async () => {
    const { recognizer, session, events } = await setup();
    recognizer.fail('busy');
    expect(session.reconnecting).toBe(true);
    expect(events.filter((e) => e.type === 'reconnecting')).toEqual([
      { type: 'reconnecting', active: true },
    ]);
    await advance(1000);
    expect(session.reconnecting).toBe(false);
    expect(events.filter((e) => e.type === 'reconnecting')).toEqual([
      { type: 'reconnecting', active: true },
      { type: 'reconnecting', active: false },
    ]);
  });

  it('a user pause during the wait ends the reconnecting state', async () => {
    const { recognizer, session } = await setup();
    recognizer.fail('network');
    session.pause();
    expect(session.reconnecting).toBe(false);
  });

  it('network: no pause, restarts with growing waits', async () => {
    const { recognizer, session } = await setup();
    recognizer.fail('network');
    await advance(500);
    expect(recognizer.starts).toBe(2);
    recognizer.fail('network');
    await advance(500);
    expect(recognizer.starts).toBe(2); // second wait is longer
    await advance(500);
    expect(recognizer.starts).toBe(3);
    expect(session.state).toBe('listening');
  });

  it('busy/network that never recover: after bounded attempts, a pause that says why', async () => {
    const { recognizer, session, events, onFlush } = await setup();
    recognizer.speak('testo da salvare');
    for (let attempt = 0; attempt < 10 && session.state === 'listening'; attempt += 1) {
      recognizer.fail('network');
      await advance(20_000);
    }
    expect(session.state).toBe('paused');
    expect(recognizer.starts).toBeLessThanOrEqual(7);
    expect(events).toContainEqual({ type: 'auto-pause', reason: 'engine-unavailable' });
    expect(onFlush).toHaveBeenCalledWith('Testo da salvare');
  });

  it('speech between two busy errors resets the attempt count', async () => {
    const { recognizer, session } = await setup();
    for (let round = 0; round < 12; round += 1) {
      recognizer.fail('busy');
      await advance(20_000);
      recognizer.speak(`frase ${round}`);
    }
    expect(session.state).toBe('listening');
  });

  it('silence: no-speech restarts keep listening for almost 2 minutes', async () => {
    const { recognizer, session, events } = await setup();
    for (let elapsed = 0; elapsed < 115_000; elapsed += 5_000) {
      await advance(5_000);
      recognizer.fail('no-speech');
    }
    expect(session.state).toBe('listening');
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'auto-pause' }));
  });

  it('about 2 minutes without speech: pause, with silence as the reason', async () => {
    const { recognizer, session, events } = await setup();
    recognizer.speak('ultima frase');
    for (let elapsed = 0; elapsed < 125_000; elapsed += 5_000) {
      await advance(5_000);
      if (session.state === 'listening') recognizer.fail('no-speech');
    }
    expect(session.state).toBe('paused');
    expect(events).toContainEqual({ type: 'auto-pause', reason: 'silence' });
  });

  it('audio-capture (a call or another app took the mic): immediate pause', async () => {
    const { recognizer, session, events } = await setup();
    recognizer.fail('audio-capture');
    expect(session.state).toBe('paused');
    expect(events).toContainEqual({ type: 'auto-pause', reason: 'audio-interruption' });
    await advance(60_000);
    expect(recognizer.starts).toBe(1); // resuming is the user's choice
  });

  it('a user pause during the wait cancels the pending restart', async () => {
    const { recognizer, session } = await setup();
    recognizer.fail('busy');
    session.pause();
    await advance(60_000);
    expect(recognizer.starts).toBe(1);
    expect(session.state).toBe('paused');
  });

  it('every engine error is reported with its native code, never with text', async () => {
    const { recognizer, events } = await setup();
    recognizer.fail('busy');
    expect(events).toContainEqual({
      type: 'engine-error',
      error: expect.objectContaining({ code: 'busy', nativeCode: 'busy' }),
    });
  });
});
