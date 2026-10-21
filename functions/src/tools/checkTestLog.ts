// Summary of the app's dev test log (registro-prove/*.jsonl, see
// app/src/features/testLog), so a manual phone test can be read in a minute.
//
// Usage (from functions/): npm run check:test-log -- <file.jsonl | dir> [...]
// Paths are resolved against the directory npm was started from.
//
// Flags, each with the event's seq so the line can be found again:
//   - errors: failed calls, engine errors, every error message shown;
//   - suggestions that delete text (the proposal drops ≥ 50% of the words);
//   - proposals unrelated to their original (almost no shared words);
//   - suggestions proposed again after the user rejected them;
//   - history items whose rationale does not say «da verificare»;
//   - why the server dropped suggestions (from the dev debug traces).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

type LogEvent = Record<string, unknown> & { seq?: number; type?: string };

interface LoggedSuggestion {
  id?: string;
  kind?: string;
  original?: string;
  proposals?: string[];
  rationale?: string;
}

export interface Flagged {
  seq: number | undefined;
  requestId: string | undefined;
  id: string | undefined;
  kind: string | undefined;
  original: string;
  proposal: string;
}

export interface TestLogSummary {
  header: LogEvent | null;
  counts: Record<string, number>;
  /** 1-based numbers of the lines that are not valid JSON. */
  badLines: number[];
  errors: LogEvent[];
  refines: {
    seq?: number;
    requestId?: string;
    durationMs?: number;
    model?: string;
    count: number;
  }[];
  deletions: (Flagged & { removedShare: number })[];
  unrelated: Flagged[];
  reproposed: (Flagged & { rejectedAtSeq: number | undefined })[];
  historyUnchecked: (Flagged & { rationale: string })[];
  droppedReasons: Record<string, number>;
}

/** Share of words a deleting proposal must drop to be flagged. */
const DELETION_SHARE = 0.5;
/** Below this share of shared words a proposal is "unrelated". */
const RELATED_SHARE = 0.2;
/** Originals shorter than this are too short to judge. */
const MIN_WORDS = 3;
const CHECK_NOTE = /da verificare|to check|to verify/i;

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

function sharedShare(a: string[], b: string[]): number {
  if (a.length === 0) return 0;
  const other = new Set(b);
  return a.filter((w) => other.has(w)).length / a.length;
}

const isError = (event: LogEvent): boolean =>
  event.type === 'ui.error' ||
  (typeof event.type === 'string' && event.type.endsWith('.error')) ||
  (event.type === 'dictation.event' && event.event === 'engine-error') ||
  (event.type === 'dictation.state' && event.to === 'error');

export function summarizeTestLog(text: string): TestLogSummary {
  const events: LogEvent[] = [];
  const badLines: number[] = [];
  text.split('\n').forEach((raw, index) => {
    if (raw.trim() === '') return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object') events.push(parsed as LogEvent);
      else badLines.push(index + 1);
    } catch {
      badLines.push(index + 1);
    }
  });

  const summary: TestLogSummary = {
    header: events.find((e) => e.type === 'header') ?? null,
    counts: {},
    badLines,
    errors: [],
    refines: [],
    deletions: [],
    unrelated: [],
    reproposed: [],
    historyUnchecked: [],
    droppedReasons: {},
  };
  const rejected = new Map<string, number | undefined>();

  for (const event of events) {
    const type = String(event.type ?? 'unknown');
    summary.counts[type] = (summary.counts[type] ?? 0) + 1;
    if (isError(event)) summary.errors.push(event);

    if (type === 'suggestion.reject' && typeof event.original === 'string') {
      rejected.set(event.original, event.seq);
    }
    if (type !== 'refine.result') continue;

    const requestId = typeof event.requestId === 'string' ? event.requestId : undefined;
    const suggestions = Array.isArray(event.suggestions)
      ? (event.suggestions as LoggedSuggestion[])
      : [];
    summary.refines.push({
      seq: event.seq,
      requestId,
      durationMs: typeof event.durationMs === 'number' ? event.durationMs : undefined,
      model: typeof event.model === 'string' ? event.model : undefined,
      count: suggestions.length,
    });

    for (const sug of suggestions) {
      const original = sug.original ?? '';
      const proposals = sug.proposals ?? [];
      const base = {
        seq: event.seq,
        requestId,
        id: sug.id,
        kind: sug.kind,
        original,
        proposal: proposals[0] ?? '',
      };
      const ow = words(original);

      if (ow.length >= MIN_WORDS && proposals.length > 0) {
        const removed = Math.max(...proposals.map((p) => 1 - words(p).length / ow.length));
        if (removed >= DELETION_SHARE) {
          summary.deletions.push({ ...base, removedShare: Math.round(removed * 100) / 100 });
        }
        const related = Math.max(
          ...proposals.map((p) => Math.max(sharedShare(words(p), ow), sharedShare(ow, words(p)))),
        );
        if (sug.kind !== 'history' && related < RELATED_SHARE) summary.unrelated.push(base);
      }
      if (rejected.has(original)) {
        summary.reproposed.push({ ...base, rejectedAtSeq: rejected.get(original) });
      }
      if (sug.kind === 'history' && !CHECK_NOTE.test(sug.rationale ?? '')) {
        summary.historyUnchecked.push({ ...base, rationale: sug.rationale ?? '' });
      }
    }

    const trace = event.debugTrace as { dropped?: { reason?: string }[] } | undefined;
    for (const dropped of trace?.dropped ?? []) {
      const reason = dropped.reason ?? 'unknown';
      summary.droppedReasons[reason] = (summary.droppedReasons[reason] ?? 0) + 1;
    }
  }
  return summary;
}

const clip = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max)}…` : text);
const flagLine = (f: Flagged) =>
  `  #${f.seq ?? '?'} ${f.id ?? ''} [${f.kind ?? '?'}] «${clip(f.original)}» → «${clip(f.proposal)}»`;

export function renderSummary(s: TestLogSummary): string {
  const out: string[] = [];
  const h = s.header ?? {};
  out.push(
    `Test log — build ${String(h.buildSha ?? '?')}, app ${String(h.appVersion ?? '?')}, ` +
      `${String(h.platform ?? '?')}, started ${String(h.startedAt ?? h.t ?? '?')}`,
  );
  out.push(
    `Events: ${Object.entries(s.counts)
      .map(([type, n]) => `${type} ${n}`)
      .join(', ')}`,
  );
  if (s.badLines.length > 0) out.push(`Unreadable lines: ${s.badLines.join(', ')}`);

  out.push('', `Errors (${s.errors.length})`);
  for (const e of s.errors) {
    const detail = [e.action, e.event, e.code, e.message].filter((x) => x !== undefined);
    out.push(`  #${e.seq ?? '?'} ${String(e.type)} ${detail.map(String).join(' · ')}`);
  }

  out.push('', `Refine calls (${s.refines.length})`);
  for (const r of s.refines) {
    out.push(
      `  #${r.seq ?? '?'} ${r.requestId ?? ''} ${r.count} suggestions, ` +
        `${r.durationMs ?? '?'} ms, ${r.model ?? '?'}`,
    );
  }

  out.push('', `Deletes text (${s.deletions.length})`);
  for (const f of s.deletions) out.push(`${flagLine(f)} (−${Math.round(f.removedShare * 100)}%)`);
  out.push('', `Unrelated proposal (${s.unrelated.length})`);
  for (const f of s.unrelated) out.push(flagLine(f));
  out.push('', `Re-proposed after reject (${s.reproposed.length})`);
  for (const f of s.reproposed) out.push(`${flagLine(f)} (rejected at #${f.rejectedAtSeq ?? '?'})`);
  out.push('', `History without «da verificare» (${s.historyUnchecked.length})`);
  for (const f of s.historyUnchecked) out.push(`${flagLine(f)} — ${clip(f.rationale)}`);

  const reasons = Object.entries(s.droppedReasons);
  out.push('', `Dropped by the server (${reasons.reduce((n, [, c]) => n + c, 0)})`);
  for (const [reason, count] of reasons) out.push(`  ${reason}: ${count}`);
  return out.join('\n');
}

/** Files to read: each argument is a .jsonl file or a directory of them. */
function collectFiles(args: string[], base: string): string[] {
  const files: string[] = [];
  for (const arg of args) {
    const full = path.resolve(base, arg);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full)
        .filter((n) => n.endsWith('.jsonl'))
        .sort()) {
        files.push(path.join(full, name));
      }
    } else {
      files.push(full);
    }
  }
  return files;
}

const PART = /^registro-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/;

/**
 * One group per day: its parts (`-2`, `-3`… after a 2 MB rotation) in writing
 * order, so a reject in one part and its re-proposal in the next are compared.
 * Other files stay alone, in the given order.
 */
export function groupLogFiles(files: string[]): string[][] {
  const days = new Map<string, { file: string; part: number }[]>();
  const groups: string[][] = [];
  const dayOrder: string[] = [];
  const others: string[][] = [];
  for (const file of files) {
    const match = PART.exec(path.basename(file));
    if (match === null) {
      others.push([file]);
      continue;
    }
    const day = match[1] as string;
    if (!days.has(day)) {
      days.set(day, []);
      dayOrder.push(day);
    }
    days.get(day)?.push({ file, part: match[2] === undefined ? 1 : Number(match[2]) });
  }
  for (const day of dayOrder.sort()) {
    groups.push((days.get(day) ?? []).sort((a, b) => a.part - b.part).map((p) => p.file));
  }
  return [...groups, ...others];
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npm run check:test-log -- <registro-*.jsonl | registro-prove/> [...]');
    process.exitCode = 2;
    return;
  }
  // npm runs scripts from functions/: resolve paths from where it was started
  const base = process.env.INIT_CWD ?? process.cwd();
  for (const group of groupLogFiles(collectFiles(args, base))) {
    console.log(`\n== ${group.join(' + ')}`);
    const text = group.map((file) => readFileSync(file, 'utf8')).join('\n');
    console.log(renderSummary(summarizeTestLog(text)));
  }
}

if (require.main === module) main();
