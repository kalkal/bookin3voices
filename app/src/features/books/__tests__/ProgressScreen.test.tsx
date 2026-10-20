// Component test of the Progress screen: goal ring (today/goal),
// streak card (computeStreak), week strip with checkmarks, bars for the
// last 7 days and the most recent book row. Data injected via fake
// repositories + InMemoryBookRepository, as for LibraryScreen/NotesScreen.

import { act, fireEvent, render } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { ThemeProvider } from '../../../theme';
import { DEFAULT_SETTINGS } from '../../settings';
import type { SettingsRepository } from '../../settings';
import { InMemoryBookRepository } from '../InMemoryBookRepository';
import { ProgressScreen } from '../ProgressScreen';
import { buildHistory, reconcileStreak } from '../dailyProgress';
import type { DailyProgressRepository } from '../dailyProgress';

const TODAY = '2026-09-10';
// history: 10, 09 and 08 above the goal (500), 07 below → streak of 3
const DAYS: Record<string, number> = {
  '2026-09-05': 600,
  '2026-09-06': 520,
  '2026-09-07': 100,
  '2026-09-08': 700,
  '2026-09-09': 800,
  '2026-09-10': 512,
};

function fakeSettings(dailyGoalWords: number): SettingsRepository {
  return {
    load: async () => ({ ...DEFAULT_SETTINGS, dailyGoalWords }),
    save: async () => {},
  };
}

function fakeProgress(days: Record<string, number>, today: string): DailyProgressRepository {
  return {
    getToday: async () => ({ date: today, words: days[today] ?? 0 }),
    addWords: async () => {},
    getHistory: async (nDays: number) => buildHistory(days, nDays, today),
    getStreak: async (goalWords: number) => reconcileStreak(null, days, goalWords, today).count,
  };
}

async function renderScreen(overrides?: {
  goal?: number;
  days?: Record<string, number>;
  books?: InMemoryBookRepository;
  onBack?: jest.Mock;
}) {
  const books = overrides?.books ?? new InMemoryBookRepository();
  const onBack = overrides?.onBack ?? jest.fn();
  const utils = await render(
    <ThemeProvider>
      <ProgressScreen
        dailyProgressRepository={fakeProgress(overrides?.days ?? DAYS, TODAY)}
        settingsRepository={fakeSettings(overrides?.goal ?? 500)}
        bookRepository={books}
        onBack={onBack}
      />
    </ThemeProvider>,
  );
  // two steps: settings load → reconciled getStreak (promise chain)
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { books, onBack, ...utils };
}

/** The system font scale the screen reads (the jest default is 2; a normal phone is 1). */
function fontScale(value: number) {
  jest
    .spyOn(Dimensions, 'get')
    .mockReturnValue({ width: 412, height: 915, scale: 2, fontScale: value });
}

describe('ProgressScreen', () => {
  it("ring: shows today's words and the goal", async () => {
    const { getByTestId } = await renderScreen();
    const ring = getByTestId('progress-ring');
    expect(ring).toHaveTextContent(/512/);
    expect(ring).toHaveTextContent(/500/);
  });

  it('streak: computeStreak over the days above the goal (3 here)', async () => {
    const { getByTestId } = await renderScreen({ goal: 800 });
    // with goal 800: only 09 (800) and yesterday... 10=512<800 → look from 09=800 (ok), 08=700<800 → streak 1
    expect(getByTestId('progress-streak')).toHaveTextContent(/1/);
  });

  it('streak: goal 500 → three days in a row', async () => {
    const { getByTestId } = await renderScreen({ goal: 500 });
    expect(getByTestId('progress-streak')).toHaveTextContent(/3/);
  });

  it('week strip: seven cells, today included', async () => {
    const { getByTestId } = await renderScreen();
    // 7 days up to today: September 04 → 10
    for (const date of buildHistory(DAYS, 7, TODAY).map((d) => d.date)) {
      expect(getByTestId(`progress-day-${date}`)).toBeTruthy();
    }
  });

  it('week strip: day with goal met is marked, day below is not', async () => {
    const { getByTestId } = await renderScreen({ goal: 500 });
    expect(getByTestId('progress-day-2026-09-09')).toHaveAccessibilityValue({ text: 'raggiunto' });
    expect(getByTestId('progress-day-2026-09-07')).toHaveAccessibilityValue({
      text: 'non raggiunto',
    });
  });

  it('bars: one bar for each of the last 7 days', async () => {
    const { getByTestId } = await renderScreen();
    for (const date of buildHistory(DAYS, 7, TODAY).map((d) => d.date)) {
      expect(getByTestId(`progress-bar-${date}`)).toBeTruthy();
    }
  });

  it('book row: title and counters of the most recent book', async () => {
    const books = new InMemoryBookRepository();
    books.seed({ id: 'mulino', title: 'Le arnie del mulino', wordCount: 24_310, chapterCount: 9 });
    const { getByTestId } = await renderScreen({ books });
    const row = getByTestId('progress-book');
    expect(row).toHaveTextContent(/Le arnie del mulino/);
    expect(row).toHaveTextContent(/9 capitoli/);
    expect(row).toHaveTextContent(/24\.310 parole/);
  });

  it('with no books the book row does not appear', async () => {
    const { queryByTestId } = await renderScreen();
    expect(queryByTestId('progress-book')).toBeNull();
  });

  it('the back button returns to the previous screen', async () => {
    const onBack = jest.fn();
    const { getByTestId } = await renderScreen({ onBack });
    await fireEvent.press(getByTestId('progress-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('the arches stand behind the screen, below the chart', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('cathedral-arches')).toBeOnTheScreen();
  });

  describe('the eye in the goal ring', () => {
    // the jest default font scale is 2 (large); a normal phone is 1
    beforeEach(() => {
      fontScale(1);
    });
    afterEach(() => jest.restoreAllMocks());

    it('with no words written today an eye stands above the 0, which stays readable', async () => {
      const { getByTestId, getByText } = await renderScreen({ days: {} });
      expect(getByTestId('goal-eye')).toBeOnTheScreen();
      expect(getByTestId('progress-ring')).toHaveTextContent(/^0di 500 parole$/);
      expect(getByText(/di 500 parole/)).toBeOnTheScreen();
    });

    it('with a very large system font the eye steps aside so the numbers fit the ring', async () => {
      fontScale(2);
      const { queryByTestId, getByTestId } = await renderScreen({ days: {} });
      expect(queryByTestId('goal-eye')).toBeNull();
      expect(getByTestId('progress-ring')).toHaveTextContent(/^0di 500 parole$/);
    });

    it('once words are written the eye gives way to the number', async () => {
      const { queryByTestId, getByTestId } = await renderScreen();
      expect(queryByTestId('goal-eye')).toBeNull();
      expect(getByTestId('progress-ring')).toHaveTextContent(/^512di 500 parole$/);
    });
  });
});
