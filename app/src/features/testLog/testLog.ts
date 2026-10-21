// Dev-only log of the owner's MANUAL tests on the phone: one JSON object per
// line (JSON Lines), kept only on the device, fetched with `adb pull`
// (path in FileTestLogStore.ts) or saved from Settings › «Scarica registro».
//
// - On only in dev builds: __DEV__ or EXPO_PUBLIC_TEST_LOG=1 (set by the
//   development and preview profiles in eas.json, never by a store build).
// - Text content is allowed (the file never leaves the device on its own),
//   but every string is capped at SNIPPET_CHARS.
// - Logging never throws: a broken disk must not break a test session.
// - Stable keys: `t` (ISO time), `seq` (per session), `type`, then the
//   event's own fields. The event types are listed in TEST_LOG_EVENTS.

export const TEST_LOG_ENABLED: boolean =
  (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_TEST_LOG === '1';

/** Longest string kept in an event (longer ones end with «…»). */
export const SNIPPET_CHARS = 300;
/** Longest array kept in an event. */
const MAX_ITEMS = 60;
/** A day's file rotates to a new one past this size. */
export const MAX_FILE_BYTES = 2_000_000;

/** Event types written by the app (the summary CLI reads the same names). */
export const TEST_LOG_EVENTS = [
  'header',
  'dictation.state',
  'dictation.event',
  'refine.request',
  'refine.result',
  'refine.error',
  'suggestion.accept',
  'suggestion.reject',
  'suggestion.acceptAll',
  'suggestion.undo',
  'outline.request',
  'outline.result',
  'outline.error',
  'outline.confirm',
  'export.result',
  'export.error',
  'ui.error',
] as const;
export type TestLogEventType = (typeof TEST_LOG_EVENTS)[number];

/** Where the lines go. `read` returns the current day's lines, in order. */
export interface TestLogStore {
  readonly location: string;
  append(line: string): void;
  read(): string;
  /** Line to write first in every new file (day change, rotation): each file reads alone. */
  setHeader?(line: string): void;
}

export interface TestLogHeader {
  buildSha: string;
  appVersion: string;
  platform: string;
  timeZone: string;
}

/** Caps strings and arrays, recursively; drops functions and undefined. */
export function capValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > SNIPPET_CHARS ? `${value.slice(0, SNIPPET_CHARS)}…` : value;
  }
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' ? undefined : value;
  }
  if (depth > 6) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => capValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const capped = capValue(inner, depth + 1);
    if (capped !== undefined) out[key] = capped;
  }
  return out;
}

class TestLog {
  private seq = 0;

  constructor(
    readonly store: TestLogStore,
    private readonly now: () => Date,
  ) {}

  format(type: TestLogEventType, data: Record<string, unknown>): string {
    const line = JSON.stringify({
      t: this.now().toISOString(),
      seq: this.seq,
      type,
      ...(capValue(data) as Record<string, unknown>),
    });
    return `${line}\n`;
  }

  record(type: TestLogEventType, data: Record<string, unknown>): void {
    try {
      const line = this.format(type, data);
      this.seq += 1;
      this.store.append(line);
    } catch (error) {
      console.warn('test-log-write-failed', error instanceof Error ? error.message : error);
    }
  }
}

let active: TestLog | null = null;

/** Starts a log session on `store`: writes the header line. */
export function installTestLog(
  store: TestLogStore,
  header: TestLogHeader,
  now: () => Date = () => new Date(),
): void {
  active = new TestLog(store, now);
  const fields = { ...header, startedAt: now().toISOString(), location: store.location };
  try {
    store.setHeader?.(active.format('header', { ...fields, continued: true }));
  } catch {
    // a store without a header still logs
  }
  active.record('header', fields);
}

export function uninstallTestLog(): void {
  active = null;
}

export function isTestLogActive(): boolean {
  return active !== null;
}

/** The store of the running session, for «Scarica registro». */
export function activeTestLogStore(): TestLogStore | null {
  return active?.store ?? null;
}

/** Records one event; a no-op when no log is installed (production, tests). */
export function logTestEvent(type: TestLogEventType, data: Record<string, unknown> = {}): void {
  active?.record(type, data);
}

/** Minimal file operations, so the rotation is testable without a device. */
export interface LogFileOps {
  readonly location: string;
  /** Size in bytes, 0 for a missing file. */
  size(name: string): number;
  append(name: string, text: string): void;
  read(name: string): string;
  list(): string[];
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * One file per day, `registro-YYYY-MM-DD.jsonl`, then `-2`, `-3`… past
 * `maxBytes`. The date is the device's local date.
 */
export class RotatingLogStore implements TestLogStore {
  private part = 1;
  private day = '';
  private header: string | null = null;

  constructor(
    private readonly files: LogFileOps,
    private readonly now: () => Date = () => new Date(),
    private readonly maxBytes: number = MAX_FILE_BYTES,
  ) {}

  get location(): string {
    return this.files.location;
  }

  setHeader(line: string): void {
    this.header = line;
  }

  private nameFor(day: string, part: number): string {
    return part === 1 ? `registro-${day}.jsonl` : `registro-${day}-${part}.jsonl`;
  }

  append(line: string): void {
    const day = localDay(this.now());
    if (day !== this.day) {
      this.day = day;
      this.part = 1;
      // resume on the last part of the day after an app restart
      while (this.files.list().includes(this.nameFor(day, this.part + 1))) this.part += 1;
    }
    const current = this.nameFor(day, this.part);
    const size = this.files.size(current);
    if (size > 0 && size + byteLength(line) > this.maxBytes) this.part += 1;
    const target = this.nameFor(day, this.part);
    // a new file starts with the session header, so each file reads on its own
    // (the session's own header line needs no copy before it)
    const isHeader = line.includes('"type":"header"');
    if (!isHeader && this.header !== null && this.files.size(target) === 0) {
      this.files.append(target, this.header);
    }
    this.files.append(target, line);
  }

  read(): string {
    const day = localDay(this.now());
    const parts: string[] = [];
    for (let part = 1; this.files.list().includes(this.nameFor(day, part)); part += 1) {
      parts.push(this.files.read(this.nameFor(day, part)));
    }
    return parts.join('');
  }
}

function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Milliseconds since the call, for the `durationMs` of an event. */
export function stopwatch(): () => number {
  const startedAt = Date.now();
  return () => Date.now() - startedAt;
}
