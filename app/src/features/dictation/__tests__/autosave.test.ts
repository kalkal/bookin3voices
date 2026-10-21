import { DebouncedSaver, type SaveStatus } from '../autosave';

function setup(options?: { delayMs?: number }) {
  const saves: string[] = [];
  const statuses: SaveStatus[] = [];
  let failNext = false;
  let localOnlyNext = false;
  const saver = new DebouncedSaver({
    save: async (text) => {
      if (failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      saves.push(text);
      if (localOnlyNext) {
        localOnlyNext = false;
        return 'local-only';
      }
    },
    delayMs: options?.delayMs,
    onStatus: (s) => statuses.push(s),
  });
  return {
    saver,
    saves,
    statuses,
    failNext: () => (failNext = true),
    localOnlyNext: () => (localOnlyNext = true),
  };
}

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('DebouncedSaver', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('a save that stayed on the phone is reported as saved-local, not saved', async () => {
    const { saver, statuses, localOnlyNext } = setup();
    localOnlyNext();
    saver.flushNow('testo');
    await flushMicrotasks();
    expect(statuses).toEqual(['saving', 'saved-local']);
  });

  it('debounce: saves only once after the delay, with the latest text', async () => {
    const { saver, saves, statuses } = setup();
    saver.schedule('prima');
    jest.advanceTimersByTime(1000);
    saver.schedule('prima e seconda');
    jest.advanceTimersByTime(2999);
    expect(saves).toEqual([]); // the timer restarted: nothing saved yet
    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    expect(saves).toEqual(['prima e seconda']);
    expect(statuses).toEqual(['pending', 'pending', 'saving', 'saved']);
  });

  it('the default delay is in the 3-5 s range', async () => {
    const { saver, saves } = setup();
    saver.schedule('testo');
    jest.advanceTimersByTime(2999);
    expect(saves).toEqual([]);
    jest.advanceTimersByTime(2001); // at 5 s it MUST have saved
    await flushMicrotasks();
    expect(saves).toEqual(['testo']);
  });

  it('flushNow skips the debounce and saves immediately', async () => {
    const { saver, saves } = setup();
    saver.schedule('in sospeso');
    saver.flushNow();
    await flushMicrotasks();
    expect(saves).toEqual(['in sospeso']);
    jest.advanceTimersByTime(10_000);
    await flushMicrotasks();
    expect(saves).toEqual(['in sospeso']); // the old timer was cancelled
  });

  it('flushNow with explicit text saves that text even without schedule', async () => {
    const { saver, saves } = setup();
    saver.flushNow('testo della pausa');
    await flushMicrotasks();
    expect(saves).toEqual(['testo della pausa']);
  });

  it('flushNow with nothing pending does not save', async () => {
    const { saver, saves } = setup();
    saver.flushNow();
    await flushMicrotasks();
    expect(saves).toEqual([]);
  });

  it('text arriving DURING a save: saved again right after, nothing lost', async () => {
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
    saver.flushNow('primo e secondo'); // the first save is still in flight
    release?.();
    await flushMicrotasks();
    release?.();
    await flushMicrotasks();
    expect(saves).toEqual(['primo', 'primo e secondo']);
  });

  it('save error: error state, the text stays and is retried by itself', async () => {
    const { saver, saves, statuses, failNext } = setup();
    failNext();
    saver.schedule('da non perdere');
    jest.advanceTimersByTime(3000);
    await flushMicrotasks();
    expect(saves).toEqual([]);
    expect(statuses).toContain('error');
    jest.advanceTimersByTime(3000); // automatic retry
    await flushMicrotasks();
    expect(saves).toEqual(['da non perdere']);
    expect(statuses[statuses.length - 1]).toBe('saved');
  });

  it('after dispose nothing runs anymore', async () => {
    const { saver, saves } = setup();
    saver.schedule('mai salvato');
    saver.dispose();
    jest.advanceTimersByTime(10_000);
    await flushMicrotasks();
    expect(saves).toEqual([]);
  });
});
