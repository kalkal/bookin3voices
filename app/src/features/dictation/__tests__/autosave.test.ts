import { DebouncedSaver, type SaveStatus } from '../autosave';

function setup(options?: { delayMs?: number }) {
  const saves: string[] = [];
  const statuses: SaveStatus[] = [];
  let failNext = false;
  const saver = new DebouncedSaver({
    save: async (text) => {
      if (failNext) {
        failNext = false;
        throw new Error('disco pieno');
      }
      saves.push(text);
    },
    delayMs: options?.delayMs,
    onStatus: (s) => statuses.push(s),
  });
  return { saver, saves, statuses, failNext: () => (failNext = true) };
}

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('DebouncedSaver', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('debounce: salva una volta sola dopo il ritardo, con l’ultimo testo', async () => {
    const { saver, saves, statuses } = setup();
    saver.schedule('prima');
    jest.advanceTimersByTime(1000);
    saver.schedule('prima e seconda');
    jest.advanceTimersByTime(2999);
    expect(saves).toEqual([]); // il timer è ripartito: non ha ancora salvato
    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(saves).toEqual(['prima e seconda']);
    expect(statuses).toEqual(['pending', 'pending', 'saving', 'saved']);
  });

  it('il ritardo di default è nel range 3–5 s', async () => {
    const { saver, saves } = setup();
    saver.schedule('testo');
    jest.advanceTimersByTime(2999);
    expect(saves).toEqual([]);
    jest.advanceTimersByTime(2001); // a 5 s DEVE aver salvato
    await flushMicrotasks();
    expect(saves).toEqual(['testo']);
  });

  it('flushNow salta il debounce e salva subito', async () => {
    const { saver, saves } = setup();
    saver.schedule('in sospeso');
    saver.flushNow();
    await flushMicrotasks();
    expect(saves).toEqual(['in sospeso']);
    jest.advanceTimersByTime(10_000);
    await flushMicrotasks();
    expect(saves).toEqual(['in sospeso']); // il timer vecchio è stato annullato
  });

  it('flushNow con testo esplicito salva quel testo anche senza schedule', async () => {
    const { saver, saves } = setup();
    saver.flushNow('testo della pausa');
    await flushMicrotasks();
    expect(saves).toEqual(['testo della pausa']);
  });

  it('flushNow senza nulla in sospeso non salva', async () => {
    const { saver, saves } = setup();
    saver.flushNow();
    await flushMicrotasks();
    expect(saves).toEqual([]);
  });

  it('testo arrivato DURANTE un salvataggio: si risalva subito dopo, niente perso', async () => {
    const saves: string[] = [];
    let release: (() => void) | undefined;
    const saver = new DebouncedSaver({
      save: (text) =>
        new Promise<void>((resolve) => {
          release = () => {
            saves.push(text);
            resolve();
          };
        }),
      delayMs: 100,
    });
    saver.flushNow('primo');
    saver.flushNow('primo e secondo'); // il primo salvataggio è ancora in volo
    release?.();
    await flushMicrotasks();
    release?.();
    await flushMicrotasks();
    expect(saves).toEqual(['primo', 'primo e secondo']);
  });

  it('errore di salvataggio: stato error, il testo resta e si ritenta da solo', async () => {
    const { saver, saves, statuses, failNext } = setup();
    failNext();
    saver.schedule('da non perdere');
    jest.advanceTimersByTime(3000);
    await flushMicrotasks();
    expect(saves).toEqual([]);
    expect(statuses).toContain('error');
    jest.advanceTimersByTime(3000); // retry automatico
    await flushMicrotasks();
    expect(saves).toEqual(['da non perdere']);
    expect(statuses[statuses.length - 1]).toBe('saved');
  });

  it('dopo dispose non parte più nulla', async () => {
    const { saver, saves } = setup();
    saver.schedule('mai salvato');
    saver.dispose();
    jest.advanceTimersByTime(10_000);
    await flushMicrotasks();
    expect(saves).toEqual([]);
  });
});
