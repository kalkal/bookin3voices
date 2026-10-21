import { DictationSession, type DictationSessionEvent } from '../DictationSession';
import { FakeDictationEngine } from '../engines/FakeDictationEngine';
import type { SessionState } from '../sessionMachine';

// the session arms a 2-minute silence timer while listening: fake timers keep
// the sessions these tests leave listening from holding the process open
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function setup(options?: { autoEmitStart?: boolean; voiceCommands?: boolean; lang?: string }) {
  const engine = new FakeDictationEngine();
  if (options?.autoEmitStart === false) engine.autoEmitStart = false;
  const onFlush = jest.fn<void, [string]>();
  const states: SessionState[] = [];
  const events: DictationSessionEvent[] = [];
  const session = new DictationSession({
    engine,
    onFlush,
    voiceCommands: options?.voiceCommands,
    lang: options?.lang,
    onStateChange: (s) => states.push(s),
    onEvent: (e) => events.push(e),
  });
  return { engine, session, onFlush, states, events };
}

describe('DictationSession — start and text', () => {
  it('starts from idle, starts the engine in it-IT and moves to listening', () => {
    const { engine, session, states } = setup();
    expect(session.state).toBe('idle');
    session.start();
    expect(session.state).toBe('listening');
    expect(engine.startCalls).toEqual([{ lang: 'it-IT' }]);
    expect(states).toEqual(['listening']);
  });

  it('accumulates finals applying voice commands', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitFinal('primo blocco punto');
    engine.emitFinal('secondo blocco');
    expect(session.text).toBe('Primo blocco. Secondo blocco');
  });

  it('with voiceCommands: false accumulates finals without post-processing', () => {
    const { engine, session } = setup({ voiceCommands: false });
    session.start();
    engine.emitFinal('primo blocco punto');
    expect(session.text).toBe('primo blocco punto');
  });

  it('forwards raw interim results only while listening', () => {
    const partials: string[] = [];
    const engine = new FakeDictationEngine();
    const session = new DictationSession({
      engine,
      onFlush: jest.fn(),
      onPartial: (raw) => partials.push(raw),
    });
    engine.emitPartial('fantasma'); // in idle: ignored
    session.start();
    engine.emitPartial('oggi pio');
    session.pause();
    engine.emitPartial('fantasma in pausa');
    expect(partials).toEqual(['oggi pio']);
  });

  it('a new start from idle clears the buffer', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitFinal('vecchio testo');
    session.stop();
    expect(session.state).toBe('idle');
    session.start();
    expect(session.text).toBe('');
  });
});

describe('DictationSession — restarts at seams and double-end dedup', () => {
  it('restarts the engine when the engine session ends while listening', () => {
    const { engine, session, events } = setup();
    session.start();
    engine.emitSingleEnd(); // engine seam
    expect(session.state).toBe('listening');
    expect(engine.startCalls).toHaveLength(2);
    expect(session.restartCount).toBe(1);
    expect(events).toContainEqual({ type: 'engine-restarted', count: 1 });
  });

  it('the text survives the seam: finals after the restart are appended', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitFinal('prima del giunto punto');
    engine.emitSingleEnd();
    engine.emitFinal('dopo il giunto');
    expect(session.text).toBe('Prima del giunto. Dopo il giunto');
  });

  it('DEDUPLICATES the double end: a single restart, the duplicate is ignored', () => {
    // the restarted engine has not yet confirmed the start when the
    // second end arrives: this is the scenario observed on the real engine
    const { engine, session, events } = setup({ autoEmitStart: false });
    session.start();
    engine.emitStart(); // confirmation of the initial start
    engine.duplicateEnd = true;
    engine.emitEnd(); // emits TWO back-to-back ends
    expect(engine.startCalls).toHaveLength(2); // initial + ONE restart, not two
    expect(session.restartCount).toBe(1);
    expect(events).toContainEqual({ type: 'duplicate-end-ignored' });
    engine.emitStart(); // the restart is confirmed: listening continues
    expect(session.state).toBe('listening');
  });

  it('restart storm → fatal error instead of an infinite loop', () => {
    const { engine, session, events, onFlush } = setup();
    session.start();
    for (let i = 0; i < 6; i += 1) engine.emitSingleEnd();
    expect(session.state).toBe('error');
    expect(events).toContainEqual({ type: 'restart-storm' });
    expect(onFlush).toHaveBeenCalled(); // the text is flushed even on error
  });
});

describe('DictationSession — pause and flush', () => {
  it('pause(): flushes the current text, stops the engine, state paused', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('testo dettato');
    session.pause();
    expect(session.state).toBe('paused');
    expect(onFlush).toHaveBeenCalledWith('Testo dettato');
    expect(engine.stopCalls).toBe(1);
  });

  it('ends (even doubled) after the pause do NOT restart the engine', () => {
    const { engine, session } = setup();
    engine.duplicateEnd = true;
    session.start();
    session.pause(); // the fake's stop emits the two ends
    expect(engine.startCalls).toHaveLength(1);
    expect(session.state).toBe('paused');
  });

  it('a late final after the pause is appended and flushed again', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('prima parte');
    session.pause();
    onFlush.mockClear();
    engine.emitFinal('coda consolidata dopo lo stop');
    expect(session.text).toBe('Prima parte coda consolidata dopo lo stop');
    expect(onFlush).toHaveBeenCalledWith('Prima parte coda consolidata dopo lo stop');
  });

  it('resuming from paused is explicit only and keeps the text', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitFinal('testo da conservare');
    session.pause();
    expect(engine.startCalls).toHaveLength(1); // no automatic resume
    session.start();
    expect(session.state).toBe('listening');
    expect(engine.startCalls).toHaveLength(2);
    expect(session.text).toBe('Testo da conservare');
  });

  it('explicit flush() (e.g. moving to background) persists the current text', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('testo a metà');
    session.flush();
    expect(onFlush).toHaveBeenCalledWith('Testo a metà');
    expect(session.state).toBe('listening'); // flush does not change state
  });
});

describe('DictationSession — audio interruption', () => {
  it('phone call: automatic pause with flush, never restart by itself', () => {
    const { engine, session, onFlush, events } = setup();
    session.start();
    engine.emitFinal('dettato prima della telefonata');
    engine.emitError({ code: 'audio-interruption', recoverable: true, message: 'telefonata' });
    expect(session.state).toBe('paused');
    expect(onFlush).toHaveBeenCalledWith('Dettato prima della telefonata');
    expect(events).toContainEqual({ type: 'auto-pause', reason: 'audio-interruption' });
    // the engine dies from the interruption: no automatic restart
    engine.emitEnd();
    expect(engine.startCalls).toHaveLength(1);
    expect(session.state).toBe('paused');
  });

  it('network down (cloud recognition): no pause, the engine restarts after a wait', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitError({ code: 'network', recoverable: true });
    engine.emitSingleEnd();
    expect(session.state).toBe('listening');
    expect(engine.startCalls).toHaveLength(1);
    jest.advanceTimersByTime(1000);
    expect(engine.startCalls).toHaveLength(2);
  });

  it('benign error (silence): no pause, the end→restart cycle continues', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitError({ code: 'no-speech', recoverable: true });
    expect(session.state).toBe('listening');
    engine.emitSingleEnd();
    expect(engine.startCalls).toHaveLength(2);
  });
});

describe('DictationSession — stop, fatal errors and recovery', () => {
  it('stop() from listening: flush, engine close and return to idle', () => {
    const { engine, session, onFlush, states } = setup();
    session.start();
    engine.emitFinal('capitolo finito');
    session.stop();
    expect(onFlush).toHaveBeenCalledWith('Capitolo finito');
    expect(engine.stopCalls).toBe(1);
    expect(states).toEqual(['listening', 'committing', 'idle']);
    expect(session.text).toBe('Capitolo finito'); // readable even after the stop
  });

  it('stop() from paused (engine already stopped): flush and idle with no waiting', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('testo');
    session.pause();
    onFlush.mockClear();
    session.stop();
    expect(session.state).toBe('idle');
    expect(onFlush).toHaveBeenCalledWith('Testo');
    expect(engine.stopCalls).toBe(1); // only the one from the pause
  });

  it('fatal error: error state with flush, then reset() → idle', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('da salvare');
    engine.emitError({ code: 'permission-denied', recoverable: false });
    expect(session.state).toBe('error');
    expect(session.error?.code).toBe('permission-denied');
    expect(onFlush).toHaveBeenCalledWith('Da salvare');
    session.reset();
    expect(session.state).toBe('idle');
    expect(session.error).toBeUndefined();
  });

  it('engine start failure → fatal error', async () => {
    const engine = new FakeDictationEngine();
    engine.start = jest.fn().mockRejectedValue(new Error('kaputt'));
    const session = new DictationSession({ engine, onFlush: jest.fn() });
    session.start();
    await Promise.resolve(); // let the promise rejection propagate
    expect(session.state).toBe('error');
  });

  it('dispose() releases the engine', () => {
    const { engine, session } = setup();
    session.dispose();
    expect(engine.disposed).toBe(true);
  });
});

describe('DictationSession — timed scripted scenario (driven Fake)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('realistic dictation: interim results, finals, seam with restart, pause', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.playScript([
      { atMs: 100, type: 'partial', text: 'oggi' },
      { atMs: 300, type: 'final', text: 'oggi piove punto' },
      { atMs: 900, type: 'end' }, // engine seam → automatic restart
      { atMs: 1400, type: 'final', text: 'domani vedremo virgola forse' },
    ]);
    jest.advanceTimersByTime(2000);
    expect(session.text).toBe('Oggi piove. Domani vedremo, forse');
    expect(session.restartCount).toBe(1);
    expect(session.state).toBe('listening');
    session.pause();
    expect(onFlush).toHaveBeenLastCalledWith('Oggi piove. Domani vedremo, forse');
  });
});

describe('DictationSession — dictation language', () => {
  it("starts the engine in the chosen language and uses that language's commands", () => {
    const { engine, session } = setup({ lang: 'en-US' });
    session.start();
    expect(engine.startCalls).toEqual([{ lang: 'en-US' }]);
    engine.emitFinal('it was raining period tomorrow');
    expect(session.text).toBe('It was raining. Tomorrow');
  });
});
