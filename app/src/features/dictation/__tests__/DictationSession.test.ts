import { DictationSession, type DictationSessionEvent } from '../DictationSession';
import { FakeDictationEngine } from '../engines/FakeDictationEngine';
import type { SessionState } from '../sessionMachine';

function setup(options?: { autoEmitStart?: boolean; voiceCommands?: boolean }) {
  const engine = new FakeDictationEngine();
  if (options?.autoEmitStart === false) engine.autoEmitStart = false;
  const onFlush = jest.fn<void, [string]>();
  const states: SessionState[] = [];
  const events: DictationSessionEvent[] = [];
  const session = new DictationSession({
    engine,
    onFlush,
    voiceCommands: options?.voiceCommands,
    onStateChange: (s) => states.push(s),
    onEvent: (e) => events.push(e),
  });
  return { engine, session, onFlush, states, events };
}

describe('DictationSession — avvio e testo', () => {
  it('parte da idle, avvia il motore in it-IT e passa a listening', () => {
    const { engine, session, states } = setup();
    expect(session.state).toBe('idle');
    session.start();
    expect(session.state).toBe('listening');
    expect(engine.startCalls).toEqual([{ lang: 'it-IT' }]);
    expect(states).toEqual(['listening']);
  });

  it('accumula i finali applicando i comandi vocali', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitFinal('primo blocco punto');
    engine.emitFinal('secondo blocco');
    expect(session.text).toBe('Primo blocco. Secondo blocco');
  });

  it('con voiceCommands: false accumula i finali senza post-processing', () => {
    const { engine, session } = setup({ voiceCommands: false });
    session.start();
    engine.emitFinal('primo blocco punto');
    expect(session.text).toBe('primo blocco punto');
  });

  it('inoltra i parziali grezzi solo in listening', () => {
    const partials: string[] = [];
    const engine = new FakeDictationEngine();
    const session = new DictationSession({
      engine,
      onFlush: jest.fn(),
      onPartial: (raw) => partials.push(raw),
    });
    engine.emitPartial('fantasma'); // in idle: ignorato
    session.start();
    engine.emitPartial('oggi pio');
    session.pause();
    engine.emitPartial('fantasma in pausa');
    expect(partials).toEqual(['oggi pio']);
  });

  it('un nuovo start da idle azzera il buffer', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitFinal('vecchio testo');
    session.stop();
    expect(session.state).toBe('idle');
    session.start();
    expect(session.text).toBe('');
  });
});

describe('DictationSession — riavvii ai giunti e dedup del doppio end', () => {
  it('riavvia il motore quando la sessione motore termina mentre si ascolta', () => {
    const { engine, session, events } = setup();
    session.start();
    engine.emitSingleEnd(); // giunto del motore
    expect(session.state).toBe('listening');
    expect(engine.startCalls).toHaveLength(2);
    expect(session.restartCount).toBe(1);
    expect(events).toContainEqual({ type: 'engine-restarted', count: 1 });
  });

  it('il testo sopravvive al giunto: i finali dopo il riavvio si accodano', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitFinal('prima del giunto punto');
    engine.emitSingleEnd();
    engine.emitFinal('dopo il giunto');
    expect(session.text).toBe('Prima del giunto. Dopo il giunto');
  });

  it('DEDUPLICA il doppio end: un solo riavvio, il doppione è ignorato', () => {
    // il motore riavviato non ha ancora confermato lo start quando arriva
    // il secondo end: è lo scenario reale osservato sul motore reale
    const { engine, session, events } = setup({ autoEmitStart: false });
    session.start();
    engine.emitStart(); // conferma dello start iniziale
    engine.duplicateEnd = true;
    engine.emitEnd(); // emette DUE end back-to-back
    expect(engine.startCalls).toHaveLength(2); // iniziale + UN riavvio, non due
    expect(session.restartCount).toBe(1);
    expect(events).toContainEqual({ type: 'duplicate-end-ignored' });
    engine.emitStart(); // il riavvio si conferma: si continua ad ascoltare
    expect(session.state).toBe('listening');
  });

  it('tempesta di riavvii → errore fatale invece di loop infinito', () => {
    const { engine, session, events, onFlush } = setup();
    session.start();
    for (let i = 0; i < 6; i += 1) engine.emitSingleEnd();
    expect(session.state).toBe('error');
    expect(events).toContainEqual({ type: 'restart-storm' });
    expect(onFlush).toHaveBeenCalled(); // anche su errore il testo si flusha
  });
});

describe('DictationSession — pausa e flush (regola di convivenza 3)', () => {
  it('pause(): flush del testo corrente, stop del motore, stato paused', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('testo dettato');
    session.pause();
    expect(session.state).toBe('paused');
    expect(onFlush).toHaveBeenCalledWith('Testo dettato');
    expect(engine.stopCalls).toBe(1);
  });

  it('gli end (anche doppi) dopo la pausa NON riavviano il motore', () => {
    const { engine, session } = setup();
    engine.duplicateEnd = true;
    session.start();
    session.pause(); // lo stop del fake emette i due end
    expect(engine.startCalls).toHaveLength(1);
    expect(session.state).toBe('paused');
  });

  it('un finale ritardatario dopo la pausa viene accodato e riflushato', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('prima parte');
    session.pause();
    onFlush.mockClear();
    engine.emitFinal('coda consolidata dopo lo stop');
    expect(session.text).toBe('Prima parte coda consolidata dopo lo stop');
    expect(onFlush).toHaveBeenCalledWith('Prima parte coda consolidata dopo lo stop');
  });

  it('la ripresa da paused è solo esplicita e conserva il testo', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitFinal('testo da conservare');
    session.pause();
    expect(engine.startCalls).toHaveLength(1); // nessuna ripresa automatica
    session.start();
    expect(session.state).toBe('listening');
    expect(engine.startCalls).toHaveLength(2);
    expect(session.text).toBe('Testo da conservare');
  });

  it('flush() esplicito (es. passaggio in background) persiste il testo corrente', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('testo a metà');
    session.flush();
    expect(onFlush).toHaveBeenCalledWith('Testo a metà');
    expect(session.state).toBe('listening'); // il flush non cambia stato
  });
});

describe('DictationSession — interruzione audio', () => {
  it('telefonata: pausa automatica con flush, mai ripartire da soli', () => {
    const { engine, session, onFlush, events } = setup();
    session.start();
    engine.emitFinal('dettato prima della telefonata');
    engine.emitError({ code: 'audio-interruption', recoverable: true, message: 'telefonata' });
    expect(session.state).toBe('paused');
    expect(onFlush).toHaveBeenCalledWith('Dettato prima della telefonata');
    expect(events).toContainEqual(expect.objectContaining({ type: 'audio-interruption' }));
    // il motore muore per l'interruzione: nessun riavvio automatico
    engine.emitEnd();
    expect(engine.startCalls).toHaveLength(1);
    expect(session.state).toBe('paused');
  });

  it('rete assente (riconoscimento cloud): stessa pausa automatica', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitError({ code: 'network', recoverable: true });
    expect(session.state).toBe('paused');
  });

  it('errore benigno (silenzio): nessuna pausa, il ciclo end→riavvio prosegue', () => {
    const { engine, session } = setup();
    session.start();
    engine.emitError({ code: 'no-speech', recoverable: true });
    expect(session.state).toBe('listening');
    engine.emitSingleEnd();
    expect(engine.startCalls).toHaveLength(2);
  });
});

describe('DictationSession — stop, errori fatali e ripristino', () => {
  it('stop() da listening: flush, chiusura motore e ritorno a idle', () => {
    const { engine, session, onFlush, states } = setup();
    session.start();
    engine.emitFinal('capitolo finito');
    session.stop();
    expect(onFlush).toHaveBeenCalledWith('Capitolo finito');
    expect(engine.stopCalls).toBe(1);
    expect(states).toEqual(['listening', 'committing', 'idle']);
    expect(session.text).toBe('Capitolo finito'); // leggibile anche dopo lo stop
  });

  it('stop() da paused (motore già fermo): flush e idle senza attese', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.emitFinal('testo');
    session.pause();
    onFlush.mockClear();
    session.stop();
    expect(session.state).toBe('idle');
    expect(onFlush).toHaveBeenCalledWith('Testo');
    expect(engine.stopCalls).toBe(1); // solo quello della pausa
  });

  it('errore fatale: stato error con flush, poi reset() → idle', () => {
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

  it('start del motore fallito → errore fatale', async () => {
    const engine = new FakeDictationEngine();
    engine.start = jest.fn().mockRejectedValue(new Error('kaputt'));
    const session = new DictationSession({ engine, onFlush: jest.fn() });
    session.start();
    await Promise.resolve(); // lascia propagare il rifiuto della promise
    expect(session.state).toBe('error');
  });

  it('dispose() rilascia il motore', () => {
    const { engine, session } = setup();
    session.dispose();
    expect(engine.disposed).toBe(true);
  });
});

describe('DictationSession — scenario a script con timing (Fake pilotato)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('dettatura realistica: parziali, finali, giunto con riavvio, pausa', () => {
    const { engine, session, onFlush } = setup();
    session.start();
    engine.playScript([
      { atMs: 100, type: 'partial', text: 'oggi' },
      { atMs: 300, type: 'final', text: 'oggi piove punto' },
      { atMs: 900, type: 'end' }, // giunto del motore → riavvio automatico
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
