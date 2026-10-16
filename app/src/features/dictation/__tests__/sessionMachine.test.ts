import { transition, type SessionEventType, type SessionState } from '../sessionMachine';

describe('sessionMachine — explicit transitions', () => {
  it.each<[SessionState, SessionEventType, SessionState, string[]]>([
    ['idle', 'USER_START', 'listening', ['resetTranscript', 'startEngine']],
    ['listening', 'USER_PAUSE', 'paused', ['flush', 'stopEngine']],
    ['listening', 'AUDIO_INTERRUPTED', 'paused', ['flush', 'stopEngine']],
    ['listening', 'ENGINE_ENDED', 'listening', ['restartEngine']],
    ['listening', 'USER_STOP', 'committing', ['flush', 'stopEngine']],
    ['paused', 'USER_START', 'listening', ['startEngine']],
    ['paused', 'USER_STOP', 'committing', ['flush']],
    ['committing', 'ENGINE_ENDED', 'committing', []],
    ['committing', 'COMMIT_DONE', 'idle', []],
    ['error', 'RESET', 'idle', []],
  ])('%s + %s → %s con effetti %j', (from, event, to, effects) => {
    const t = transition(from, event);
    expect(t.ignored).toBe(false);
    expect(t.to).toBe(to);
    expect(t.effects).toEqual(effects);
  });

  it('resuming from paused does NOT clear the buffer (no resetTranscript)', () => {
    expect(transition('paused', 'USER_START').effects).not.toContain('resetTranscript');
  });

  it('FATAL_ERROR from every active state leads to error with flush (never lose text)', () => {
    for (const from of ['idle', 'listening', 'paused', 'committing'] as const) {
      const t = transition(from, 'FATAL_ERROR');
      expect(t.to).toBe('error');
      expect(t.effects).toEqual(['flush', 'stopEngine']);
    }
  });

  it('FATAL_ERROR in error is ignored', () => {
    expect(transition('error', 'FATAL_ERROR')).toEqual({ to: 'error', effects: [], ignored: true });
  });

  it.each<[SessionState, SessionEventType]>([
    ['idle', 'USER_PAUSE'],
    ['idle', 'USER_STOP'],
    ['idle', 'ENGINE_ENDED'],
    ['idle', 'AUDIO_INTERRUPTED'],
    ['listening', 'USER_START'],
    ['listening', 'COMMIT_DONE'],
    ['paused', 'USER_PAUSE'],
    ['paused', 'ENGINE_ENDED'], // the engine dies while paused: no automatic restart
    ['paused', 'AUDIO_INTERRUPTED'],
    ['committing', 'USER_START'],
    ['committing', 'USER_STOP'],
    ['error', 'USER_START'],
    ['error', 'ENGINE_ENDED'],
  ])('ignora esplicitamente %s + %s', (from, event) => {
    const t = transition(from, event);
    expect(t.ignored).toBe(true);
    expect(t.to).toBe(from);
    expect(t.effects).toEqual([]);
  });
});
