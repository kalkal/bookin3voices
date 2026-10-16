// Progress diary (a lightweight take on a writing-tracker app):
// LOCAL counter of added words, fed by chapter saves
// (OfflineFirstChapterRepository.onWordsAdded). Lives in AsyncStorage,
// not Firestore: it is motivational, per-device data and not part of the
// book — losing it is not a bug, polluting it with sync is.
//
// Schema v2: besides the current day we keep a short HISTORY
// (days{ 'YYYY-MM-DD': words }) to feed the streak and the weekly chart.
// A v1 payload { date, words } is migrated on the fly (upgrade-on-read) so
// the words already counted are never lost; on write the history is pruned
// to the last ~35 days (enough for the week + chart, without bloating the
// disk).
//
// Schema v3: the STREAK (consecutive days above the goal) must not be capped
// by pruning — a motivational feature cannot freeze at 35 for someone who has
// been writing for 40 days. The problem is that the `days` history is pruned,
// so counting the streak from it alone limits it to the window. So we keep a
// separate, UNPRUNED record `streak { count, lastGoalMetDate }` and RECONCILE it
// on read, where the goal (which lives in Settings, not here) and today's words
// are known: the counter survives pruning and can grow without limit. `days`
// stays pruned for the week and the chart. Migration v1/v2 → v3 is pure
// upgrade-on-read: neither the history nor a running streak is ever lost (it
// is rebuilt from the visible history at the first reconciliation).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { KeyValueStorage } from '../chapters';

const STORAGE_KEY = 'bookvoice/daily-progress';

/** Days of history kept on disk: a week plus margin for the streak. */
export const MAX_HISTORY_DAYS = 35;

// external data (disk) validated at the boundary with Zod
const storedProgressV1Schema = z.object({
  schemaVersion: z.literal(1),
  /** Local day in YYYY-MM-DD format. */
  date: z.string(),
  words: z.number().int().min(0),
});

const storedProgressV2Schema = z.object({
  schemaVersion: z.literal(2),
  /** Words per local day (YYYY-MM-DD → count). */
  days: z.record(z.string(), z.number().int().min(0)),
});

/**
 * Persisted streak, OUTSIDE the pruned record: `count` consecutive days above
 * the goal ending on `lastGoalMetDate` (null = no streak in progress).
 * Keeping the real date of the last day the goal was met, a gap is detected
 * EVEN beyond the 35 days of history.
 */
const streakRecordSchema = z.object({
  count: z.number().int().min(0),
  lastGoalMetDate: z.string().nullable(),
});

const storedProgressV3Schema = z.object({
  schemaVersion: z.literal(3),
  days: z.record(z.string(), z.number().int().min(0)),
  /** Absent on freshly migrated payloads: the streak is seeded on first read. */
  streak: streakRecordSchema.optional(),
});

export type StreakRecord = z.infer<typeof streakRecordSchema>;
export type StoredProgress = z.infer<typeof storedProgressV3Schema>;

export interface DailyProgress {
  date: string;
  words: number;
}

export interface DailyProgressRepository {
  /** Words added today; restarts from zero when the day changes. */
  getToday(): Promise<DailyProgress>;
  /** Sum of added words (negative deltas are ignored). */
  addWords(delta: number): Promise<void>;
  /** Last `nDays` days up to today, oldest first, with gaps zero-filled. */
  getHistory(nDays: number): Promise<DailyProgress[]>;
  /**
   * Current streak (consecutive days above `goalWords`), reconciled and
   * persisted with the unpruned counter: it grows past the 35-day cap. The
   * goal comes from Settings, which this storage does not know, so it must be passed in.
   */
  getStreak(goalWords: number): Promise<number>;
}

/** LOCAL day key (the goal follows the writer's clock). */
export function localDateKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Shifts a day key by `delta` days, handling month/year boundaries.
 * Builds the date from its components (local midnight) to avoid the
 * time-zone pitfalls of ISO parsing.
 */
export function shiftDateKey(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return localDateKey(date);
}

/**
 * Brings any stored payload to schema v3 without losing data: a valid v3
 * (history + streak) passes through intact; a v2 becomes v3 keeping `days`
 * (the streak is rebuilt from the history at the first reconciliation); a v1
 * { date, words } becomes { days: { [date]: words } }; everything else
 * (corrupt, unknown) becomes an empty history. Pure function: the Zod
 * boundary makes it 100% testable.
 */
export function upgradeStoredProgress(raw: unknown): StoredProgress {
  const v3 = storedProgressV3Schema.safeParse(raw);
  if (v3.success) return v3.data;
  const v2 = storedProgressV2Schema.safeParse(raw);
  if (v2.success) return { schemaVersion: 3, days: v2.data.days };
  const v1 = storedProgressV1Schema.safeParse(raw);
  if (v1.success) return { schemaVersion: 3, days: { [v1.data.date]: v1.data.words } };
  return { schemaVersion: 3, days: {} };
}

/** Keeps only the last `keep` recorded days (ISO dates sort chronologically). */
export function pruneDays(
  days: Record<string, number>,
  keep: number = MAX_HISTORY_DAYS,
): Record<string, number> {
  const keys = Object.keys(days).sort();
  if (keys.length <= keep) return days;
  const kept = keys.slice(keys.length - keep);
  const out: Record<string, number> = {};
  for (const key of kept) out[key] = days[key];
  return out;
}

/**
 * Daily series: `nDays` days up to `today`, oldest to newest, with days
 * without writing set to zero. Pure: the UI draws bars and checkmarks from it
 * without knowing anything about the storage.
 */
export function buildHistory(
  days: Record<string, number>,
  nDays: number,
  today: string,
): DailyProgress[] {
  const history: DailyProgress[] = [];
  for (let offset = nDays - 1; offset >= 0; offset--) {
    const date = shiftDateKey(today, -offset);
    history.push({ date, words: days[date] ?? 0 });
  }
  return history;
}

/**
 * Streak = number of CONSECUTIVE days with words >= goal, counted backwards
 * from today. Product decision (declared default): "reach the goal", not
 * "wrote at least something". Today still below the goal does NOT reset the
 * streak — the day is in progress: counting starts from yesterday. An invalid
 * goal (<= 0) produces no streak (this also avoids an infinite loop).
 */
export function computeStreak(
  days: Record<string, number>,
  goalWords: number,
  today: string,
): number {
  if (goalWords <= 0) return 0;
  const reached = (key: string) => (days[key] ?? 0) >= goalWords;

  // day in progress: if today has not (yet) been reached, start from yesterday
  let cursor = reached(today) ? today : shiftDateKey(today, -1);
  let streak = 0;
  while (reached(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

/** Whole days between two day keys: shiftDateKey(from, daysBetween(from,to)) === to. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  // UTC midnight of both: two points a whole number of days apart, immune to DST
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Reconciles the persisted streak with the UNPRUNED counter: it lets the
 * streak grow past 35 days, surviving the pruning of `days`, while staying
 * idempotent per day. Pure (no IO): the repository wraps it by reading/writing.
 *
 * `computeStreak` on the visible history is EXACT for streaks that fit
 * inside it (gaps included) and stops at the window edge when saturated:
 * there the record takes over, remembering the older part beyond the window.
 * The record EXTENDS the streak only if it is contiguous with the visible run
 * (its `lastGoalMetDate` touches the window): so a real gap — even beyond 35
 * days — detaches the record and the streak RESTARTS. Advancing the record by
 * all the consecutive days up to today (not just +1 from yesterday) also holds
 * up if reading skips a few days even though the user wrote every day.
 *
 * Declared product decisions:
 * - Goal change: the streak is NOT recomputed retroactively. Within the
 *   visible window the new goal applies (a recent day that no longer reaches
 *   it breaks the run); the part beyond the window keeps the count earned
 *   back then — a past day that met a different goal stays counted, history
 *   is not rewritten.
 * - Idempotency: re-reading the same day does not increment (delta 0 when
 *   `lastGoalMetDate` is already today).
 */
export function reconcileStreak(
  stored: StreakRecord | null,
  days: Record<string, number>,
  goalWords: number,
  today: string,
): StreakRecord {
  if (goalWords <= 0) return { count: 0, lastGoalMetDate: null };
  const reached = (key: string) => (days[key] ?? 0) >= goalWords;

  // last day that counts for the current run (today, or yesterday if today is in progress)
  const anchor = reached(today) ? today : shiftDateKey(today, -1);
  if (!reached(anchor)) return { count: 0, lastGoalMetDate: null };

  // length proven by the visible history (exact ≤ window, saturated at the edge)
  const windowStreak = computeStreak(days, goalWords, today);
  const earliestVisible = shiftDateKey(anchor, -(windowStreak - 1));
  const edge = shiftDateKey(earliestVisible, -1); // day just before the visible run

  // The record EXTENDS only across the pruning horizon: if `edge` exists
  // in the history (so the run stopped on a day the goal was NOT met, not
  // for lack of data) the streak ended there and the record does not extend it —
  // so raising the goal breaks it inside the window, without rewriting
  // history beyond it.
  const prunedBeyondWindow = days[edge] === undefined;
  const last = stored?.lastGoalMetDate ?? null;
  if (stored !== null && last !== null && prunedBeyondWindow && last <= anchor && last >= edge) {
    // the record covers up to `last`; the days up to `anchor` are in the run
    const extended = stored.count + Math.max(0, daysBetween(last, anchor));
    return { count: Math.max(extended, windowStreak), lastGoalMetDate: anchor };
  }
  // no useful record (absent or detached by a gap): the visible window applies
  return { count: windowStreak, lastGoalMetDate: anchor };
}

export class LocalDailyProgressRepository implements DailyProgressRepository {
  private readonly storage: KeyValueStorage;
  private readonly today: () => string;

  constructor(storage: KeyValueStorage = AsyncStorage, today: () => string = localDateKey) {
    this.storage = storage;
    this.today = today;
  }

  /** Reads the history from disk, bringing it to schema v3 (never throws). */
  private async readStored(): Promise<StoredProgress> {
    const raw = await this.storage.getItem(STORAGE_KEY);
    if (raw === null) return { schemaVersion: 3, days: {} };
    try {
      return upgradeStoredProgress(JSON.parse(raw));
    } catch {
      // unreadable JSON: rebuildable motivational data, start clean
      return { schemaVersion: 3, days: {} };
    }
  }

  /** Persists history + streak in one go, always at the current schema. */
  private async writeStored(days: Record<string, number>, streak?: StreakRecord): Promise<void> {
    const payload: StoredProgress = { schemaVersion: 3, days };
    if (streak !== undefined) payload.streak = streak;
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  async getToday(): Promise<DailyProgress> {
    const date = this.today();
    const stored = await this.readStored();
    return { date, words: stored.days[date] ?? 0 };
  }

  async addWords(delta: number): Promise<void> {
    const rounded = Math.round(delta);
    if (rounded <= 0) return;
    const date = this.today();
    const stored = await this.readStored();
    const days = pruneDays({ ...stored.days, [date]: (stored.days[date] ?? 0) + rounded });
    // the streak is not touched here (we do not know the goal) but it must be kept,
    // otherwise pruning would lose it: it is reconciled on read
    await this.writeStored(days, stored.streak);
  }

  async getHistory(nDays: number): Promise<DailyProgress[]> {
    const stored = await this.readStored();
    return buildHistory(stored.days, nDays, this.today());
  }

  async getStreak(goalWords: number): Promise<number> {
    const stored = await this.readStored();
    const streak = reconcileStreak(stored.streak ?? null, stored.days, goalWords, this.today());
    // persistent reconciliation: the unpruned counter survives and grows
    await this.writeStored(stored.days, streak);
    return streak.count;
  }
}
