// Summary of the app's dev test log (JSON Lines), so a manual test session
// reads fast: errors and the suggestions worth a second look.

import { groupLogFiles, renderSummary, summarizeTestLog } from '../checkTestLog';

const line = (event: Record<string, unknown>) => JSON.stringify(event);

const LOG = [
  line({ t: '2026-10-21T10:00:00.000Z', seq: 0, type: 'header', buildSha: 'abc1234' }),
  line({ seq: 1, type: 'dictation.state', from: 'idle', to: 'listening', recognizer: 'server' }),
  line({ seq: 2, type: 'dictation.event', event: 'engine-error', code: 'network' }),
  line({ seq: 3, type: 'refine.request', requestId: 'ref-1', words: 120 }),
  line({
    seq: 4,
    type: 'refine.result',
    requestId: 'ref-1',
    durationMs: 4200,
    model: 'amazon.nova-pro-v1:0',
    promptVersion: 3,
    suggestions: [
      {
        id: 'ref-1-1',
        kind: 'style',
        original: 'posò lentamente la tazza sul tavolo di legno',
        proposals: ['posò'],
        rationale: 'avverbio',
      },
      {
        id: 'ref-1-2',
        kind: 'pacing',
        original: 'il vento soffiava forte sulla collina',
        proposals: ['una pentola bolle in cucina'],
        rationale: 'ritmo',
      },
      {
        id: 'ref-1-3',
        kind: 'history',
        aspect: 'period',
        original: 'la lampada a olio',
        proposals: ['il lume a petrolio'],
        rationale: 'Nel 1850 si usava il petrolio.',
      },
      {
        id: 'ref-1-4',
        kind: 'grammar',
        original: 'un altra',
        proposals: ["un'altra"],
        rationale: 'elisione',
      },
    ],
    debugTrace: {
      dropped: [{ kind: 'style', original: 'x', proposals: ['y'], reason: 'original-not-found' }],
    },
  }),
  line({
    seq: 5,
    type: 'suggestion.reject',
    suggestionId: 'ref-1-4',
    original: 'un altra',
    proposal: "un'altra",
  }),
  line({ seq: 6, type: 'suggestion.accept', suggestionId: 'ref-1-1', before: 'a', after: 'b' }),
  line({
    seq: 7,
    type: 'refine.result',
    requestId: 'ref-2',
    durationMs: 3100,
    suggestions: [
      {
        id: 'ref-2-1',
        kind: 'grammar',
        original: 'un altra',
        proposals: ["un'altra"],
        rationale: 'elisione',
      },
    ],
  }),
  line({ seq: 8, type: 'ui.error', action: 'refine', code: 'unavailable', message: 'Riprova' }),
  'not json at all',
].join('\n');

describe('summarizeTestLog', () => {
  const summary = summarizeTestLog(LOG);

  it('reads the header and counts the events', () => {
    expect(summary.header).toMatchObject({ buildSha: 'abc1234' });
    expect(summary.counts['refine.result']).toBe(2);
    expect(summary.badLines).toEqual([10]);
  });

  it('lists the errors', () => {
    expect(summary.errors.map((e) => e.seq)).toEqual([2, 8]);
  });

  it('flags suggestions that delete text', () => {
    expect(summary.deletions.map((s) => s.id)).toEqual(['ref-1-1']);
    expect(summary.deletions[0]?.removedShare).toBeGreaterThanOrEqual(0.5);
  });

  it('flags proposals unrelated to their original', () => {
    expect(summary.unrelated.map((s) => s.id)).toEqual(['ref-1-2']);
  });

  it('flags a rejected suggestion proposed again later', () => {
    expect(summary.reproposed).toEqual([
      expect.objectContaining({ id: 'ref-2-1', original: 'un altra', rejectedAtSeq: 5 }),
    ]);
  });

  it('flags history items whose rationale lacks «da verificare»', () => {
    expect(summary.historyUnchecked.map((s) => s.id)).toEqual(['ref-1-3']);
  });

  it('collects the server drop reasons from the debug traces', () => {
    expect(summary.droppedReasons).toEqual({ 'original-not-found': 1 });
  });

  it('renders a short readable report', () => {
    const text = renderSummary(summary);
    expect(text).toMatch(/Errors \(2\)/);
    expect(text).toMatch(/Deletes text \(1\)/);
    expect(text).toMatch(/Re-proposed after reject \(1\)/);
    expect(text).toMatch(/History without «da verificare» \(1\)/);
  });
});

describe('groupLogFiles', () => {
  it('joins the parts of a day in writing order, one group per day', () => {
    expect(
      groupLogFiles([
        '/p/registro-2026-10-21-10.jsonl',
        '/p/registro-2026-10-22.jsonl',
        '/p/registro-2026-10-21-2.jsonl',
        '/p/registro-2026-10-21.jsonl',
        '/p/altro.jsonl',
      ]),
    ).toEqual([
      [
        '/p/registro-2026-10-21.jsonl',
        '/p/registro-2026-10-21-2.jsonl',
        '/p/registro-2026-10-21-10.jsonl',
      ],
      ['/p/registro-2026-10-22.jsonl'],
      ['/p/altro.jsonl'],
    ]);
  });

  it('a reject in part 1 and the same proposal in part 2 is caught once joined', () => {
    const part1 = line({ seq: 5, type: 'suggestion.reject', original: 'un altra' });
    const part2 = line({
      seq: 9,
      type: 'refine.result',
      suggestions: [{ id: 'r-1', kind: 'grammar', original: 'un altra', proposals: ["un'altra"] }],
    });
    expect(summarizeTestLog(`${part1}\n${part2}\n`).reproposed).toHaveLength(1);
  });
});
