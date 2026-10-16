// L'adapter si testa iniettando un modulo nativo finto: qui si verifica SOLO il
// mapping (opzioni di start, risultati, errori) e che l'adapter NON deduplichi
// il doppio `end` — quella responsabilità è di DictationSession.

import { ExpoDictationEngine, type SpeechModule } from '../engines/ExpoDictationEngine';
import type { DictationEngineEvents } from '../types';

// jest solleva il mock prima degli import: il modulo nativo reale non si carica
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

describe('ExpoDictationEngine — adapter su expo-speech-recognition', () => {
  it('avvia il motore con le opzioni validate in prova', async () => {
    const { engine, nativeModule } = setup();
    await engine.start({ lang: 'it-IT' });
    expect(nativeModule.start).toHaveBeenCalledWith({
      lang: 'it-IT',
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: false,
      addsPunctuation: true,
    });
  });

  it('permesso negato: errore fatale, il motore non parte', async () => {
    const { engine, nativeModule, received } = setup(false);
    await engine.start({ lang: 'it-IT' });
    expect(nativeModule.start).not.toHaveBeenCalled();
    expect(received.errors).toEqual([{ code: 'permission-denied', recoverable: false }]);
  });

  it('mappa i risultati: parziali e finali, scartando i trascritti vuoti', () => {
    const { handlers, received } = setup();
    handlers.result({ isFinal: false, results: [{ transcript: 'oggi pio' }] });
    handlers.result({ isFinal: true, results: [{ transcript: 'oggi piove' }] });
    handlers.result({ isFinal: true, results: [] });
    handlers.result({ isFinal: true, results: [{ transcript: '' }] });
    expect(received.partials).toEqual(['oggi pio']);
    expect(received.finals).toEqual(['oggi piove']);
  });

  it('inoltra start e OGNI end senza deduplicare (la dedup è della sessione)', () => {
    const { handlers, received } = setup();
    handlers.start(null);
    handlers.end(null);
    handlers.end(null); // doppio end del motore reale: passa tale e quale
    expect(received.starts).toBe(1);
    expect(received.ends).toBe(2);
  });

  it.each([
    ['audio-capture', 'audio-interruption', true],
    ['interrupted', 'audio-interruption', true],
    ['busy', 'audio-interruption', true],
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

  it('stop() e pause() fermano il motore in modo gentile (consolida i finali)', async () => {
    const { engine, nativeModule } = setup();
    await engine.stop();
    await engine.pause();
    expect(nativeModule.stop).toHaveBeenCalledTimes(2);
  });

  it('dispose() rimuove tutte le subscription native', () => {
    const { engine, removals } = setup();
    expect(removals).toHaveLength(4); // start, end, result, error
    engine.dispose();
    for (const remove of removals) expect(remove).toHaveBeenCalled();
  });
});
