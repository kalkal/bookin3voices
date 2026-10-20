// The history prompts are code: any change bumps HISTORY_PROMPT_VERSION, updates
// these snapshots and replays the golden set (npm run golden).

import {
  HISTORY_PROMPT_VERSION,
  buildDetectPeriodPrompt,
  buildReportHistoryPrompt,
} from '../historyPrompt';

describe('history prompts', () => {
  it('version', () => {
    expect(HISTORY_PROMPT_VERSION).toBe(3);
  });

  it('snapshot: detect step', () => {
    expect(buildDetectPeriodPrompt('Napoli, 1943. La strada era deserta.')).toMatchSnapshot();
  });

  it('snapshot: report step, with the period given by the code', () => {
    expect(
      buildReportHistoryPrompt({
        text: 'Napoli, 1943. La strada era deserta.',
        periodLabel: 'Naples, 1943',
        quote: 'Napoli, 1943',
        language: 'it',
      }),
    ).toMatchSnapshot();
  });

  it('notes follow the book language', () => {
    const prompt = buildReportHistoryPrompt({
      text: 'London, 1888.',
      periodLabel: 'London, 1888',
      quote: 'London, 1888',
      language: 'en',
    });
    expect(prompt.systemInstruction).toContain('in English');
  });
});
