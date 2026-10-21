// The adapter is tested by injecting a fake native module: this checks ONLY the
// mapping (start options, results, errors) and that the adapter does NOT
// deduplicate the double `end`; that responsibility belongs to DictationSession.

import { ExpoDictationEngine, type SpeechModule } from '../engines/ExpoDictationEngine';
import type { DictationEngineEvents } from '../types';

// jest hoists the mock above the imports: the real native module is never loaded
jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));

type Handler = (event: unknown) => void;

function setup(granted = true) {
  const handlers: Record<string, Handler> = {};
  const removals: jest.Mock[] = [];
  const nativeModule = {
    start: jest.fn(),
    stop: jest.fn(),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted }),
    addListener: jest.fn((name: string, handler: Handler) => {
      handlers[name] = handler;
      const remove = jest.fn();
      removals.push(remove);
      return { remove };
    }),
  };
  const engine = new ExpoDictationEngine(nativeModule as unknown as SpeechModule);
  const received = {
    partials: [] as string[],
    finals: [] as string[],
    starts: 0,
    ends: 0,
    errors: [] as { code: string; recoverable: boolean }[],
  };
  const events: DictationEngineEvents = {
    onPartial: (t) => received.partials.push(t),
    onFinal: (t) => received.finals.push(t),
    onStart: () => (received.starts += 1),
    onEnd: () => (received.ends += 1),
    onError: (e) => received.errors.push({ code: e.code, recoverable: e.recoverable }),
  };
  engine.setEvents(events);
  return { engine, nativeModule, handlers, removals, received };
}

describe('ExpoDictationEngine — adapter over expo-speech-recognition', () => {
  it('starts the engine with the options validated in testing', async () => {
    const { engine, nativeModule } = setup();
    await engine.start({ lang: 'it-IT' });
    expect(nativeModule.start).toHaveBeenCalledWith({
      lang: 'it-IT',
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
      addsPunctuation: false,
    });
  });

  it('permission denied: fatal error, the engine does not start', async () => {
    const { engine, nativeModule, received } = setup(false);
    await engine.start({ lang: 'it-IT' });
    expect(nativeModule.start).not.toHaveBeenCalled();
    expect(received.errors).toEqual([{ code: 'permission-denied', recoverable: false }]);
  });

  it('maps results: interim and final, discarding empty transcripts', () => {
    const { handlers, received } = setup();
    handlers.result({ isFinal: false, results: [{ transcript: 'oggi pio' }] });
    handlers.result({ isFinal: true, results: [{ transcript: 'oggi piove' }] });
    handlers.result({ isFinal: true, results: [] });
    handlers.result({ isFinal: true, results: [{ transcript: '' }] });
    expect(received.partials).toEqual(['oggi pio']);
    expect(received.finals).toEqual(['oggi piove']);
  });

  it('forwards start and EVERY end without deduplicating (dedup belongs to the session)', () => {
    const { handlers, received } = setup();
    handlers.start(null);
    handlers.end(null);
    handlers.end(null); // double end from the real engine: passes through as-is
    expect(received.starts).toBe(1);
    expect(received.ends).toBe(2);
  });

  it.each([
    ['audio-capture', 'audio-interruption', true],
    ['interrupted', 'audio-interruption', true],
    ['busy', 'busy', true],
    ['network', 'network', true],
    ['no-speech', 'no-speech', true],
    ['speech-timeout', 'no-speech', true],
    ['not-allowed', 'permission-denied', false],
    ['service-not-allowed', 'permission-denied', false],
    ['language-not-supported', 'unknown', false],
  ])("mappa l'errore nativo %s → %s (recoverable: %s)", (native, code, recoverable) => {
    const { handlers, received } = setup();
    handlers.error({ error: native, message: '' });
    expect(received.errors).toEqual([{ code, recoverable }]);
  });

  it('stop() and pause() stop the engine gently (finalizing the results)', async () => {
    const { engine, nativeModule } = setup();
    await engine.stop();
    await engine.pause();
    expect(nativeModule.stop).toHaveBeenCalledTimes(2);
  });

  it('dispose() removes all native subscriptions', () => {
    const { engine, removals } = setup();
    expect(removals).toHaveLength(4); // start, end, result, error
    engine.dispose();
    for (const remove of removals) expect(remove).toHaveBeenCalled();
  });
});
