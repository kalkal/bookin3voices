// Offline golden run: recorded Nova answers replayed through the SAME provider
// factory as the callables (bedrock, with a fake client), then the same checks
// as `npm run golden`. No network, no real model call: safe for CI.

import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { onlyAdds } from '../../ai/history/historyCheck';
import { listRecordings, profileFromArg, runOfflinePassage } from '../goldenSetRunner';

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

describe('golden set of the historical profile, offline', () => {
  const historical = listRecordings('historical');

  it('has its own recorded passages', () => {
    expect(historical.length).toBeGreaterThanOrEqual(2);
  });

  it.each(historical)(
    '%s: no FAIL, every MUST item covered, unsafe proposals dropped',
    async (file) => {
      const { report, mustDrop, sent } = await runOfflinePassage(file, 'historical');
      expect(sent).toBe(1);
      expect(report.violations.filter((v) => v.level === 'fail')).toEqual([]);
      expect(report.coverage.missed).toEqual([]);
      for (const original of mustDrop) {
        expect(report.suggestions.map((s) => s.original)).not.toContain(original);
      }
      expect(report.count).toBe(report.rawCount - mustDrop.length);
    },
  );
});

describe('recorded period details', () => {
  const recordedDir = path.resolve(
    __dirname,
    '../../../../content/style-profiles/historical/golden-set/recorded',
  );

  it.each(listRecordings('historical'))(
    '%s: every period detail only adds words, as the real check requires',
    (file) => {
      const recording = JSON.parse(
        readFileSync(path.join(recordedDir, file.replace(/\.md$/, '.json')), 'utf8'),
      ) as {
        output: { suggestions: { aspect?: string; original: string; proposals: string[] }[] };
      };
      const details = recording.output.suggestions.filter((s) => s.aspect === 'period');
      expect(details.length).toBeGreaterThan(0);
      for (const detail of details) {
        for (const proposal of detail.proposals) {
          expect(onlyAdds(detail.original, proposal)).toBe(true);
        }
      }
    },
  );
});

describe('--profile', () => {
  it('defaults to suspense and accepts a known style', () => {
    expect(profileFromArg(undefined)).toBe('suspense');
    expect(profileFromArg('historical')).toBe('historical');
  });

  it('rejects an unknown style instead of running the default set', () => {
    expect(() => profileFromArg('historcal')).toThrow(/unknown --profile "historcal"/);
    expect(() => profileFromArg('thriller')).toThrow(/unknown --profile/);
  });
});
