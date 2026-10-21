// Dev-only test log: one JSON line per event, capped snippets, rotation.

import {
  installTestLog,
  isTestLogActive,
  logTestEvent,
  RotatingLogStore,
  SNIPPET_CHARS,
  uninstallTestLog,
  type LogFileOps,
} from '..';

/** In-memory files: name → content. */
function memoryFiles(): LogFileOps & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    location: 'mem://registro-prove',
    size: (name) => new TextEncoder().encode(files.get(name) ?? '').length,
    append: (name, text) => files.set(name, (files.get(name) ?? '') + text),
    read: (name) => files.get(name) ?? '',
    list: () => [...files.keys()].sort(),
  };
}

const NOW = new Date('2026-10-21T14:05:06.789Z');
const HEADER = {
  buildSha: 'abc1234',
  appVersion: '1.0.0',
  platform: 'android',
  timeZone: 'Europe/Rome',
};

const lines = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

afterEach(() => uninstallTestLog());

describe('test log', () => {
  it('is a silent no-op until installed', () => {
    expect(isTestLogActive()).toBe(false);
    expect(() => logTestEvent('refine.request', { requestId: 'r' })).not.toThrow();
  });

  it('writes a header, then one JSON line per event with time and sequence', () => {
    const ops = memoryFiles();
    installTestLog(new RotatingLogStore(ops, () => NOW), HEADER, () => NOW);
    logTestEvent('dictation.state', { from: 'idle', to: 'listening' });
    logTestEvent('refine.request', { requestId: 'ref-1', words: 120 });

    const [name] = ops.list();
    expect(name).toBe('registro-2026-10-21.jsonl');
    const written = lines(ops.read(name as string));
    expect(written[0]).toEqual({
      t: NOW.toISOString(),
      seq: 0,
      type: 'header',
      ...HEADER,
      startedAt: NOW.toISOString(),
      location: 'mem://registro-prove',
    });
    expect(written[1]).toMatchObject({ seq: 1, type: 'dictation.state', to: 'listening' });
    expect(written[2]).toMatchObject({ seq: 2, type: 'refine.request', words: 120 });
  });

  it('caps every string, however deep', () => {
    const ops = memoryFiles();
    installTestLog(new RotatingLogStore(ops, () => NOW), HEADER, () => NOW);
    const long = 'x'.repeat(SNIPPET_CHARS + 100);
    logTestEvent('suggestion.accept', { before: long, nested: { list: [long] } });

    const event = lines(ops.read(ops.list()[0] as string))[1] as {
      before: string;
      nested: { list: string[] };
    };
    expect(event.before).toHaveLength(SNIPPET_CHARS + 1);
    expect(event.before.endsWith('…')).toBe(true);
    expect(event.nested.list[0]).toHaveLength(SNIPPET_CHARS + 1);
  });

  it('rotates to a new file past the size limit', () => {
    const ops = memoryFiles();
    const store = new RotatingLogStore(ops, () => NOW, 400);
    installTestLog(store, HEADER, () => NOW);
    for (let i = 0; i < 6; i += 1) logTestEvent('ui.error', { message: 'm'.repeat(80) });

    expect(ops.list().length).toBeGreaterThan(1);
    expect(ops.list()).toContain('registro-2026-10-21.jsonl');
    expect(ops.list()).toContain('registro-2026-10-21-2.jsonl');
    for (const name of ops.list()) {
      expect(ops.size(name)).toBeLessThanOrEqual(400);
      // every file can be read on its own: it starts with the session header
      const [first] = lines(ops.read(name));
      expect(first).toMatchObject({ type: 'header', buildSha: 'abc1234' });
    }
    expect(lines(ops.read('registro-2026-10-21-2.jsonl'))[0]).toMatchObject({ continued: true });
    // read() gives every file of the day, in writing order
    const events = lines(store.read()).filter((e) => e.type !== 'header');
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('starts a new day with the header too', () => {
    const ops = memoryFiles();
    let now = NOW;
    installTestLog(new RotatingLogStore(ops, () => now), HEADER, () => now);
    now = new Date('2026-10-22T09:00:00.000Z');
    logTestEvent('ui.error', { message: 'domani' });

    const nextDay = lines(ops.read('registro-2026-10-22.jsonl'));
    expect(nextDay.map((e) => e.type)).toEqual(['header', 'ui.error']);
    expect(nextDay[0]).toMatchObject({ continued: true, startedAt: NOW.toISOString() });
  });

  it('never lets a broken store break the app', () => {
    const ops = memoryFiles();
    ops.append = () => {
      throw new Error('disk full');
    };
    installTestLog(new RotatingLogStore(ops, () => NOW), HEADER, () => NOW);
    expect(() => logTestEvent('export.result', { ok: true })).not.toThrow();
  });
});
