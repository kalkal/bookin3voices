// Offline golden run: recorded Nova answers replayed through the SAME provider
// factory as the callables (bedrock, with a fake client), then the same checks
// as `npm run golden`. No network, no real model call: safe for CI.

import { listRecordings, runOfflinePassage } from '../goldenSetRunner';

const recordings = listRecordings();

describe('golden set, offline (recorded answers through the provider factory)', () => {
  it('has recordings to replay', () => {
    expect(recordings.length).toBeGreaterThanOrEqual(5);
  });

  it.each(recordings)(
    '%s: no FAIL, every MUST item covered, unsafe proposals dropped',
    async (file) => {
      const { report, mustDrop, sent } = await runOfflinePassage(file);
      expect(sent).toBe(1); // exactly one call, to the fake client
      expect(report.violations.filter((v) => v.level === 'fail')).toEqual([]);
      expect(report.coverage.missed).toEqual([]);
      for (const original of mustDrop) {
        expect(report.suggestions.map((s) => s.original)).not.toContain(original);
      }
      // nothing else was lost on the way: the recorded good suggestions all survive
      const recordedGood = report.rawCount - mustDrop.length;
      expect(report.count).toBe(recordedGood);
    },
  );
});
