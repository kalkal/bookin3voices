import {
  LocalDailyProgressRepository,
  buildHistory,
  computeStreak,
  daysBetween,
  localDateKey,
  pruneDays,
  reconcileStreak,
  shiftDateKey,
  upgradeStoredProgress,
} from '../dailyProgress';
import type { KeyValueStorage } from '../../chapters';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
  return { storage, data };
}

const KEY = 'bookvoice/daily-progress';

describe('localDateKey', () => {
  it('uses the local day in YYYY-MM-DD format', () => {
    expect(localDateKey(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05');
    expect(localDateKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('shiftDateKey', () => {
  it('shifts days across month and year changes', () => {
    expect(shiftDateKey('2026-09-05', -1)).toBe('2026-09-04');
    expect(shiftDateKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28'); // 2026 is not a leap year
    expect(shiftDateKey('2026-09-05', +2)).toBe('2026-09-07');
  });
});

describe('upgradeStoredProgress (v1/v2 → v3 migration)', () => {
  it('keeps the data of a v1 payload by moving it into days[date]', () => {
    const v3 = upgradeStoredProgress({ schemaVersion: 1, date: '2026-09-05', words: 320 });
    expect(v3).toEqual({ schemaVersion: 3, days: { '2026-09-05': 320 } });
  });

  it('upgrades a v2 payload to v3 keeping the history (streak to be rebuilt)', () => {
    const days = { '2026-09-04': 100, '2026-09-05': 250 };
    expect(upgradeStoredProgress({ schemaVersion: 2, days })).toEqual({ schemaVersion: 3, days });
  });

  it('leaves an already-v3 payload intact (history + streak)', () => {
    const v3 = {
      schemaVersion: 3 as const,
      days: { '2026-09-05': 250 },
      streak: { count: 12, lastGoalMetDate: '2026-09-05' },
    };
    expect(upgradeStoredProgress(v3)).toEqual(v3);
  });

  it('an unrecognizable payload becomes an empty history (no throw)', () => {
    expect(upgradeStoredProgress({ pippo: true })).toEqual({ schemaVersion: 3, days: {} });
    expect(upgradeStoredProgress(null)).toEqual({ schemaVersion: 3, days: {} });
    expect(upgradeStoredProgress({ schemaVersion: 2, days: { x: -3 } })).toEqual({
      schemaVersion: 3,
      days: {},
    });
  });
});

describe('daysBetween', () => {
  it('counts whole days between two keys, even across month/year boundaries', () => {
    expect(daysBetween('2026-09-05', '2026-09-05')).toBe(0);
    expect(daysBetween('2026-09-05', '2026-09-06')).toBe(1);
    expect(daysBetween('2026-08-31', '2026-09-05')).toBe(5);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-09-10', '2026-08-01')).toBe(-40); // beyond the 35-day window
  });
});

describe('pruneDays', () => {
  it('keeps only the last N recorded days, the most recent ones', () => {
    const days: Record<string, number> = {};
    // 40 consecutive real days up to 2026-09-10
    for (let i = 0; i < 40; i++) days[shiftDateKey('2026-09-10', -i)] = i;
    const pruned = pruneDays(days, 35);
    expect(Object.keys(pruned)).toHaveLength(35);
    // the 5 oldest days (offset 39..35) are pruned, the rest kept
    expect(pruned['2026-09-10']).toBe(0); // today (offset 0) kept
    expect(pruned[shiftDateKey('2026-09-10', -34)]).toBe(34); // the oldest one kept
    expect(pruned[shiftDateKey('2026-09-10', -35)]).toBeUndefined(); // first one pruned
  });

  it('leaves a history shorter than the limit untouched', () => {
    const days = { '2026-09-04': 10, '2026-09-05': 20 };
    expect(pruneDays(days, 35)).toEqual(days);
  });
});

describe('buildHistory', () => {
  it('returns n days up to today, oldest first, with gaps zero-filled', () => {
    const days = { '2026-09-03': 100, '2026-09-05': 400 };
    const history = buildHistory(days, 4, '2026-09-05');
    expect(history).toEqual([
      { date: '2026-09-02', words: 0 },
      { date: '2026-09-03', words: 100 },
      { date: '2026-09-04', words: 0 },
      { date: '2026-09-05', words: 400 },
    ]);
  });

  it('empty history: all zeros, ascending order, today last', () => {
    const history = buildHistory({}, 3, '2026-01-01');
    expect(history).toEqual([
      { date: '2025-12-30', words: 0 },
      { date: '2025-12-31', words: 0 },
      { date: '2026-01-01', words: 0 },
    ]);
  });
});

describe('computeStreak (consecutive days with words >= goal)', () => {
  const goal = 500;

  it('empty history: no streak', () => {
    expect(computeStreak({}, goal, '2026-09-05')).toBe(0);
  });

  it('goal met today and on the previous days: today counts too', () => {
    const days = { '2026-09-03': 500, '2026-09-04': 600, '2026-09-05': 700 };
    expect(computeStreak(days, goal, '2026-09-05')).toBe(3);
  });

  it('today not yet met does NOT reset: the streak holds from yesterday', () => {
    const days = { '2026-09-03': 500, '2026-09-04': 600, '2026-09-05': 120 };
    expect(computeStreak(days, goal, '2026-09-05')).toBe(2);
  });

  it('today below and yesterday below: streak is zero', () => {
    const days = { '2026-09-04': 100, '2026-09-05': 120 };
    expect(computeStreak(days, goal, '2026-09-05')).toBe(0);
  });

  it('a missing day breaks the streak', () => {
    const days = { '2026-09-01': 500, '2026-09-02': 500, '2026-09-04': 500, '2026-09-05': 500 };
    // 05 and 04 ok, 03 missing → stop
    expect(computeStreak(days, goal, '2026-09-05')).toBe(2);
  });

  it('the streak crosses a month change', () => {
    const days = { '2026-08-30': 500, '2026-08-31': 500, '2026-09-01': 500 };
    expect(computeStreak(days, goal, '2026-09-01')).toBe(3);
  });

  it('goal met exactly (>=) counts', () => {
    const days = { '2026-09-05': 500 };
    expect(computeStreak(days, goal, '2026-09-05')).toBe(1);
  });

  it('invalid goal (<= 0) does not produce infinite streaks', () => {
    const days = { '2026-09-04': 0, '2026-09-05': 0 };
    expect(computeStreak(days, 0, '2026-09-05')).toBe(0);
  });
});

describe('reconcileStreak (unpruned streak, beyond the 35-day cap)', () => {
  const goal = 500;
  const TODAY = '2026-09-10';

  /** History of `n` consecutive days above the goal ending on `end`. */
  function run(end: string, n: number, words = 600): Record<string, number> {
    const days: Record<string, number> = {};
    for (let i = 0; i < n; i++) days[shiftDateKey(end, -i)] = words;
    return days;
  }

  it('without a record it starts from the visible history (computeStreak behavior)', () => {
    const days = run(TODAY, 3);
    expect(reconcileStreak(null, days, goal, TODAY)).toEqual({ count: 3, lastGoalMetDate: TODAY });
  });

  it('EXCEEDS the 35 cap: record at yesterday + today met → +1 beyond the window', () => {
    // history pruned to 35 days, but the real streak is 40: the record carries it forward
    const days = run(TODAY, 35);
    const stored = { count: 39, lastGoalMetDate: shiftDateKey(TODAY, -1) };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 40,
      lastGoalMetDate: TODAY,
    });
  });

  it('idempotent: re-reading the same day does not increment', () => {
    const days = run(TODAY, 35);
    const stored = { count: 40, lastGoalMetDate: TODAY };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 40,
      lastGoalMetDate: TODAY,
    });
  });

  it('recovers days skipped by reading but written (advances the whole stretch)', () => {
    // written every day (full history) but not reconciled for 4 days
    const days = run(TODAY, 35);
    const stored = { count: 36, lastGoalMetDate: shiftDateKey(TODAY, -4) };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 40,
      lastGoalMetDate: TODAY,
    });
  });

  it('gap BEYOND 35 days: old record detached → the streak restarts', () => {
    // the visible history shows only today; the old record (January) is not contiguous
    const days = { [TODAY]: 600 };
    const stored = { count: 50, lastGoalMetDate: '2026-01-01' };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 1,
      lastGoalMetDate: TODAY,
    });
  });

  it('today in progress (not yet met): the streak holds up to yesterday', () => {
    const days = { ...run(shiftDateKey(TODAY, -1), 35), [TODAY]: 100 };
    const stored = { count: 40, lastGoalMetDate: shiftDateKey(TODAY, -1) };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 40,
      lastGoalMetDate: shiftDateKey(TODAY, -1),
    });
  });

  it('streak ended (neither today nor yesterday met): zero', () => {
    const days = { [shiftDateKey(TODAY, -1)]: 100, [TODAY]: 120 };
    const stored = { count: 12, lastGoalMetDate: shiftDateKey(TODAY, -3) };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({ count: 0, lastGoalMetDate: null });
  });

  it('raised goal: does not recompute history but breaks inside the visible window', () => {
    // yesterday's 520 met 500 but not 800; with goal 800 the visible streak is only today
    const days = { [shiftDateKey(TODAY, -1)]: 520, [TODAY]: 900 };
    const stored = { count: 10, lastGoalMetDate: shiftDateKey(TODAY, -1) };
    // the record at yesterday is NO longer contiguous (yesterday does not reach 800) → restarts from today
    expect(reconcileStreak(stored, days, 800, TODAY)).toEqual({ count: 1, lastGoalMetDate: TODAY });
  });

  it('invalid goal (<= 0): no streak', () => {
    expect(reconcileStreak({ count: 9, lastGoalMetDate: TODAY }, run(TODAY, 3), 0, TODAY)).toEqual({
      count: 0,
      lastGoalMetDate: null,
    });
  });
});

describe('LocalDailyProgressRepository', () => {
  it('starts from zero and accumulates positive deltas', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-05');
    expect((await repo.getToday()).words).toBe(0);
    await repo.addWords(120);
    await repo.addWords(-40); // deletions do not take away motivation
    await repo.addWords(30);
    expect(await repo.getToday()).toEqual({ date: '2026-09-05', words: 150 });
  });

  it('restarts from zero when the day changes but does NOT lose the history', async () => {
    const { storage } = memoryStorage();
    let today = '2026-09-05';
    const repo = new LocalDailyProgressRepository(storage, () => today);
    await repo.addWords(500);
    today = '2026-09-06';
    expect(await repo.getToday()).toEqual({ date: '2026-09-06', words: 0 });
    await repo.addWords(80);
    expect((await repo.getToday()).words).toBe(80);
    // the previous day is still in the history
    const history = await repo.getHistory(2);
    expect(history).toEqual([
      { date: '2026-09-05', words: 500 },
      { date: '2026-09-06', words: 80 },
    ]);
  });

  it('reads (upgrade-on-read) a v1 payload without losing it', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 1, date: '2026-09-05', words: 640 }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-05');
    expect((await repo.getToday()).words).toBe(640);
    // and while continuing to accumulate, the v1 data remains
    await repo.addWords(60);
    expect((await repo.getToday()).words).toBe(700);
  });

  it('on write it prunes to the last 35 days', async () => {
    const seed: Record<string, number> = {};
    for (let d = 1; d <= 34; d++) seed[`2026-08-${String(d > 31 ? 31 : d).padStart(2, '0')}`] = 10;
    // wide history spread over several months
    const wide: Record<string, number> = {};
    for (let i = 0; i < 40; i++) wide[shiftDateKey('2026-09-10', -i)] = 10;
    const { storage, data } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 2, days: wide }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-10');
    await repo.addWords(5);
    const stored = JSON.parse(data.get(KEY) as string);
    expect(Object.keys(stored.days).length).toBeLessThanOrEqual(35);
    // today is among the kept ones
    expect(stored.days['2026-09-10']).toBe(15);
  });

  it('getHistory zero-fills the days without writing', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 2, days: { '2026-09-08': 200, '2026-09-10': 300 } }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-10');
    expect(await repo.getHistory(3)).toEqual([
      { date: '2026-09-08', words: 200 },
      { date: '2026-09-09', words: 0 },
      { date: '2026-09-10', words: 300 },
    ]);
  });

  it('a corrupt payload restarts from zero without throwing', async () => {
    const { storage } = memoryStorage({ [KEY]: '{rotto' });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-05');
    expect((await repo.getToday()).words).toBe(0);
    expect(await repo.getHistory(1)).toEqual([{ date: '2026-09-05', words: 0 }]);
  });

  it('getStreak: a streak beyond 35 days survives the history pruning', async () => {
    // long legacy history (40 consecutive days above the goal, unpruned)
    const wide: Record<string, number> = {};
    for (let i = 0; i < 40; i++) wide[shiftDateKey('2026-09-10', -i)] = 600;
    const { storage, data } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 3, days: wide }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-10');

    // first read: the streak picks up all 40 visible days and persists it
    expect(await repo.getStreak(500)).toBe(40);
    // a write prunes the history to 35, but the streak record stays at 40…
    await repo.addWords(50);
    const stored = JSON.parse(data.get(KEY) as string);
    expect(Object.keys(stored.days).length).toBeLessThanOrEqual(35);
    expect(stored.streak.count).toBe(40);
    // …and re-reading confirms 40 (idempotent, no double counting)
    expect(await repo.getStreak(500)).toBe(40);
    expect(await repo.getStreak(500)).toBe(40);
  });

  it('getStreak: v2 → v3 migration keeps the history and rebuilds the running streak', async () => {
    const days = { '2026-09-08': 600, '2026-09-09': 600, '2026-09-10': 600 };
    const { storage, data } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 2, days }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-10');

    expect(await repo.getStreak(500)).toBe(3); // existing streak rebuilt
    const stored = JSON.parse(data.get(KEY) as string);
    expect(stored.schemaVersion).toBe(3);
    expect(stored.days).toEqual(days); // history not lost
    expect(stored.streak).toEqual({ count: 3, lastGoalMetDate: '2026-09-10' });
  });

  it('getStreak: the next day, once the goal is met, the streak goes up by one', async () => {
    const days = { '2026-09-09': 600, '2026-09-10': 600 };
    const { storage } = memoryStorage({ [KEY]: JSON.stringify({ schemaVersion: 3, days }) });
    let today = '2026-09-10';
    const repo = new LocalDailyProgressRepository(storage, () => today);
    expect(await repo.getStreak(500)).toBe(2);
    // new day: nothing written yet → the streak holds at 2 (day in progress)
    today = '2026-09-11';
    expect(await repo.getStreak(500)).toBe(2);
    // writes and reaches the goal → 3
    await repo.addWords(600);
    expect(await repo.getStreak(500)).toBe(3);
  });
});
