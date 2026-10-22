// Every callable in index.ts must go through the judges' demo gate: a new
// callable added later without it would be open to anyone in the demo (the
// classic «the gate only covers the functions that existed»). Only the ones
// listed here may skip it, each for a stated reason.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const UNGATED: Record<string, string> = {
  ping: 'returns { ok: true }, touches no data and no model',
  redeemAccessCode: 'is the gate itself',
};

const source = readFileSync(join(__dirname, '..', '..', 'index.ts'), 'utf8');

/** Each `export const name = onCall(...)` with the text of its declaration. */
function exportedCallables(): Array<{ name: string; body: string }> {
  const starts = [...source.matchAll(/export const (\w+) = onCall\(/g)];
  return starts.map((match, i) => ({
    name: match[1] as string,
    body: source.slice(match.index, starts[i + 1]?.index ?? source.length),
  }));
}

describe('every callable is gated in the judges demo', () => {
  const callables = exportedCallables();

  it('finds the callables', () => {
    expect(callables.map((c) => c.name)).toEqual(
      expect.arrayContaining(['refineChapter', 'generateOutline', 'refineTitle', 'exportBook']),
    );
  });

  it.each(exportedCallables().map((c) => [c.name, c.body] as const))(
    '%s passes demoGate or withDemoAccess',
    (name, body) => {
      if (name in UNGATED) return;
      expect(/\bdemoGate\b|withDemoAccess\(/.test(body)).toBe(true);
    },
  );
});
