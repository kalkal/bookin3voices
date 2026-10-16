// Test di componente della schermata Progressi: anello obiettivo (oggi/obiettivo),
// card serie (computeStreak), striscia della settimana con spunte, barre degli
// ultimi 7 giorni e riga del libro più recente. Dati iniettati via repository
// finti + InMemoryBookRepository, come per LibraryScreen/NotesScreen.

import { act, fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import { DEFAULT_SETTINGS } from '../../settings';
import type { SettingsRepository } from '../../settings';
import { InMemoryBookRepository } from '../InMemoryBookRepository';
import { ProgressScreen } from '../ProgressScreen';
import { buildHistory, reconcileStreak } from '../dailyProgress';
import type { DailyProgressRepository } from '../dailyProgress';

const TODAY = '2026-09-10';
// storico: 10 e 09 e 08 sopra l'obiettivo (500), 07 sotto → serie di 3
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
  // due passaggi: caricamento impostazioni → getStreak riconciliato (catena di promise)
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { books, onBack, ...utils };
}

describe('ProgressScreen', () => {
  it('anello: mostra parole di oggi e obiettivo', async () => {
    const { getByTestId } = await renderScreen();
    const ring = getByTestId('progress-ring');
    expect(ring).toHaveTextContent(/512/);
    expect(ring).toHaveTextContent(/500/);
  });

  it('serie: computeStreak sui giorni sopra obiettivo (qui 3)', async () => {
    const { getByTestId } = await renderScreen({ goal: 800 });
    // con obiettivo 800: solo 09 (800) e ieri... 10=512<800 → si guarda da 09=800 (ok), 08=700<800 → serie 1
    expect(getByTestId('progress-streak')).toHaveTextContent(/1/);
  });

  it('serie: obiettivo 500 → tre giorni di fila', async () => {
    const { getByTestId } = await renderScreen({ goal: 500 });
    expect(getByTestId('progress-streak')).toHaveTextContent(/3/);
  });

  it('striscia settimana: sette celle, oggi incluso', async () => {
    const { getByTestId } = await renderScreen();
    // 7 giorni fino a oggi: 04 → 10 settembre
    for (const date of buildHistory(DAYS, 7, TODAY).map((d) => d.date)) {
      expect(getByTestId(`progress-day-${date}`)).toBeTruthy();
    }
  });

  it('striscia settimana: giorno raggiunto marcato, giorno sotto no', async () => {
    const { getByTestId } = await renderScreen({ goal: 500 });
    expect(getByTestId('progress-day-2026-09-09')).toHaveAccessibilityValue({ text: 'raggiunto' });
    expect(getByTestId('progress-day-2026-09-07')).toHaveAccessibilityValue({
      text: 'non raggiunto',
    });
  });

  it('barre: una barra per ciascuno degli ultimi 7 giorni', async () => {
    const { getByTestId } = await renderScreen();
    for (const date of buildHistory(DAYS, 7, TODAY).map((d) => d.date)) {
      expect(getByTestId(`progress-bar-${date}`)).toBeTruthy();
    }
  });

  it('riga libro: titolo e contatori del libro più recente', async () => {
    const books = new InMemoryBookRepository();
    books.seed({ id: 'faro', title: 'Il custode del faro', wordCount: 24_310, chapterCount: 9 });
    const { getByTestId } = await renderScreen({ books });
    const row = getByTestId('progress-book');
    expect(row).toHaveTextContent(/Il custode del faro/);
    expect(row).toHaveTextContent(/9 capitoli/);
    expect(row).toHaveTextContent(/24\.310 parole/);
  });

  it('senza libri la riga libro non compare', async () => {
    const { queryByTestId } = await renderScreen();
    expect(queryByTestId('progress-book')).toBeNull();
  });

  it('il tasto indietro torna alla schermata precedente', async () => {
    const onBack = jest.fn();
    const { getByTestId } = await renderScreen({ onBack });
    await fireEvent.press(getByTestId('progress-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
