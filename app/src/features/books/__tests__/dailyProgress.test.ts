import {
  LocalDailyProgressRepository,
  buildHistory,
  computeStreak,
  daysBetween,
  localDateKey,
  pruneDays,
  reconcileStreak,
  shiftDateKey,
  upgradeStoredProgress,
} from '../dailyProgress';
import type { KeyValueStorage } from '../../chapters';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
  return { storage, data };
}

const KEY = 'bookvoice/daily-progress';

describe('localDateKey', () => {
  it('usa il giorno locale in formato YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05');
    expect(localDateKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('shiftDateKey', () => {
  it('scala i giorni gestendo cambio mese e anno', () => {
    expect(shiftDateKey('2026-09-05', -1)).toBe('2026-09-04');
    expect(shiftDateKey('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28'); // 2026 non bisestile
    expect(shiftDateKey('2026-09-05', +2)).toBe('2026-09-07');
  });
});

describe('upgradeStoredProgress (migrazione v1/v2 → v3)', () => {
  it('conserva il dato di un payload v1 spostandolo in days[date]', () => {
    const v3 = upgradeStoredProgress({ schemaVersion: 1, date: '2026-09-05', words: 320 });
    expect(v3).toEqual({ schemaVersion: 3, days: { '2026-09-05': 320 } });
  });

  it('porta un payload v2 a v3 conservando lo storico (serie da ricostruire)', () => {
    const days = { '2026-09-04': 100, '2026-09-05': 250 };
    expect(upgradeStoredProgress({ schemaVersion: 2, days })).toEqual({ schemaVersion: 3, days });
  });

  it('lascia intatto un payload già v3 (storico + serie)', () => {
    const v3 = {
      schemaVersion: 3 as const,
      days: { '2026-09-05': 250 },
      streak: { count: 12, lastGoalMetDate: '2026-09-05' },
    };
    expect(upgradeStoredProgress(v3)).toEqual(v3);
  });

  it('un payload irriconoscibile diventa storico vuoto (nessun lancio)', () => {
    expect(upgradeStoredProgress({ pippo: true })).toEqual({ schemaVersion: 3, days: {} });
    expect(upgradeStoredProgress(null)).toEqual({ schemaVersion: 3, days: {} });
    expect(upgradeStoredProgress({ schemaVersion: 2, days: { x: -3 } })).toEqual({
      schemaVersion: 3,
      days: {},
    });
  });
});

describe('daysBetween', () => {
  it('conta i giorni interi tra due chiavi, anche a cavallo di mese/anno', () => {
    expect(daysBetween('2026-09-05', '2026-09-05')).toBe(0);
    expect(daysBetween('2026-09-05', '2026-09-06')).toBe(1);
    expect(daysBetween('2026-08-31', '2026-09-05')).toBe(5);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-09-10', '2026-08-01')).toBe(-40); // oltre la finestra dei 35
  });
});

describe('pruneDays', () => {
  it('tiene solo gli ultimi N giorni registrati, i più recenti', () => {
    const days: Record<string, number> = {};
    // 40 giorni consecutivi e reali fino al 2026-09-10
    for (let i = 0; i < 40; i++) days[shiftDateKey('2026-09-10', -i)] = i;
    const pruned = pruneDays(days, 35);
    expect(Object.keys(pruned)).toHaveLength(35);
    // i 5 giorni più vecchi (offset 39..35) sono potati, il resto tenuto
    expect(pruned['2026-09-10']).toBe(0); // oggi (offset 0) tenuto
    expect(pruned[shiftDateKey('2026-09-10', -34)]).toBe(34); // il più vecchio tenuto
    expect(pruned[shiftDateKey('2026-09-10', -35)]).toBeUndefined(); // primo potato
  });

  it('non tocca uno storico più corto del limite', () => {
    const days = { '2026-09-04': 10, '2026-09-05': 20 };
    expect(pruneDays(days, 35)).toEqual(days);
  });
});

describe('buildHistory', () => {
  it('torna n giorni fino a oggi, dal più vecchio, con zero-fill dei buchi', () => {
    const days = { '2026-09-03': 100, '2026-09-05': 400 };
    const history = buildHistory(days, 4, '2026-09-05');
    expect(history).toEqual([
      { date: '2026-09-02', words: 0 },
      { date: '2026-09-03', words: 100 },
      { date: '2026-09-04', words: 0 },
      { date: '2026-09-05', words: 400 },
    ]);
  });

  it('storico vuoto: tutti zero, ordine crescente, oggi in coda', () => {
    const history = buildHistory({}, 3, '2026-01-01');
    expect(history).toEqual([
      { date: '2025-12-30', words: 0 },
      { date: '2025-12-31', words: 0 },
      { date: '2026-01-01', words: 0 },
    ]);
  });
});

describe('computeStreak (giorni consecutivi con parole >= obiettivo)', () => {
  const goal = 500;

  it('storico vuoto: nessuna serie', () => {
    expect(computeStreak({}, goal, '2026-09-05')).toBe(0);
  });

  it('obiettivo raggiunto oggi e nei giorni prima: conta anche oggi', () => {
    const days = { '2026-09-03': 500, '2026-09-04': 600, '2026-09-05': 700 };
    expect(computeStreak(days, goal, '2026-09-05')).toBe(3);
  });

  it('oggi non ancora raggiunto NON azzera: la serie regge da ieri', () => {
    const days = { '2026-09-03': 500, '2026-09-04': 600, '2026-09-05': 120 };
    expect(computeStreak(days, goal, '2026-09-05')).toBe(2);
  });

  it('oggi sotto e ieri sotto: serie a zero', () => {
    const days = { '2026-09-04': 100, '2026-09-05': 120 };
    expect(computeStreak(days, goal, '2026-09-05')).toBe(0);
  });

  it('un giorno bucato interrompe la serie', () => {
    const days = { '2026-09-01': 500, '2026-09-02': 500, '2026-09-04': 500, '2026-09-05': 500 };
    // 05 e 04 ok, 03 mancante → stop
    expect(computeStreak(days, goal, '2026-09-05')).toBe(2);
  });

  it('la serie attraversa il cambio di mese', () => {
    const days = { '2026-08-30': 500, '2026-08-31': 500, '2026-09-01': 500 };
    expect(computeStreak(days, goal, '2026-09-01')).toBe(3);
  });

  it('obiettivo esattamente raggiunto (>=) conta', () => {
    const days = { '2026-09-05': 500 };
    expect(computeStreak(days, goal, '2026-09-05')).toBe(1);
  });

  it('obiettivo non valido (<= 0) non genera serie infinite', () => {
    const days = { '2026-09-04': 0, '2026-09-05': 0 };
    expect(computeStreak(days, 0, '2026-09-05')).toBe(0);
  });
});

describe('reconcileStreak (serie non potata, oltre il tetto dei 35 giorni)', () => {
  const goal = 500;
  const TODAY = '2026-09-10';

  /** Storico di `n` giorni consecutivi sopra l'obiettivo terminanti in `end`. */
  function run(end: string, n: number, words = 600): Record<string, number> {
    const days: Record<string, number> = {};
    for (let i = 0; i < n; i++) days[shiftDateKey(end, -i)] = words;
    return days;
  }

  it('senza record parte dallo storico visibile (comportamento di computeStreak)', () => {
    const days = run(TODAY, 3);
    expect(reconcileStreak(null, days, goal, TODAY)).toEqual({ count: 3, lastGoalMetDate: TODAY });
  });

  it('SUPERA il tetto di 35: record a ieri + oggi raggiunto → +1 oltre la finestra', () => {
    // storico potato a 35 giorni, ma la serie reale è 40: il record la porta avanti
    const days = run(TODAY, 35);
    const stored = { count: 39, lastGoalMetDate: shiftDateKey(TODAY, -1) };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 40,
      lastGoalMetDate: TODAY,
    });
  });

  it('idempotente: rileggere lo stesso giorno non incrementa', () => {
    const days = run(TODAY, 35);
    const stored = { count: 40, lastGoalMetDate: TODAY };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 40,
      lastGoalMetDate: TODAY,
    });
  });

  it('recupera i giorni saltati dalla lettura ma scritti (avanza di tutto il tratto)', () => {
    // scritto ogni giorno (storico pieno) ma non riconciliato per 4 giorni
    const days = run(TODAY, 35);
    const stored = { count: 36, lastGoalMetDate: shiftDateKey(TODAY, -4) };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 40,
      lastGoalMetDate: TODAY,
    });
  });

  it('buco OLTRE i 35 giorni: record vecchio staccato → la serie riparte', () => {
    // lo storico visibile mostra solo oggi; il record vecchio (gennaio) non è contiguo
    const days = { [TODAY]: 600 };
    const stored = { count: 50, lastGoalMetDate: '2026-01-01' };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 1,
      lastGoalMetDate: TODAY,
    });
  });

  it('oggi in corso (non ancora raggiunto): la serie regge fino a ieri', () => {
    const days = { ...run(shiftDateKey(TODAY, -1), 35), [TODAY]: 100 };
    const stored = { count: 40, lastGoalMetDate: shiftDateKey(TODAY, -1) };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({
      count: 40,
      lastGoalMetDate: shiftDateKey(TODAY, -1),
    });
  });

  it('serie spenta (né oggi né ieri raggiunti): zero', () => {
    const days = { [shiftDateKey(TODAY, -1)]: 100, [TODAY]: 120 };
    const stored = { count: 12, lastGoalMetDate: shiftDateKey(TODAY, -3) };
    expect(reconcileStreak(stored, days, goal, TODAY)).toEqual({ count: 0, lastGoalMetDate: null });
  });

  it('obiettivo alzato: non ricalcola la storia ma spezza dentro la finestra visibile', () => {
    // ieri 520 raggiungeva 500 ma non 800; con obiettivo 800 la serie visibile è solo oggi
    const days = { [shiftDateKey(TODAY, -1)]: 520, [TODAY]: 900 };
    const stored = { count: 10, lastGoalMetDate: shiftDateKey(TODAY, -1) };
    // il record a ieri NON è più contiguo (ieri non raggiunge 800) → riparte da oggi
    expect(reconcileStreak(stored, days, 800, TODAY)).toEqual({ count: 1, lastGoalMetDate: TODAY });
  });

  it('obiettivo non valido (<= 0): nessuna serie', () => {
    expect(reconcileStreak({ count: 9, lastGoalMetDate: TODAY }, run(TODAY, 3), 0, TODAY)).toEqual({
      count: 0,
      lastGoalMetDate: null,
    });
  });
});

describe('LocalDailyProgressRepository', () => {
  it('parte da zero e accumula i delta positivi', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-05');
    expect((await repo.getToday()).words).toBe(0);
    await repo.addWords(120);
    await repo.addWords(-40); // le cancellazioni non tolgono motivazione
    await repo.addWords(30);
    expect(await repo.getToday()).toEqual({ date: '2026-09-05', words: 150 });
  });

  it('riparte da zero al cambio di giorno ma NON perde lo storico', async () => {
    const { storage } = memoryStorage();
    let today = '2026-09-05';
    const repo = new LocalDailyProgressRepository(storage, () => today);
    await repo.addWords(500);
    today = '2026-09-06';
    expect(await repo.getToday()).toEqual({ date: '2026-09-06', words: 0 });
    await repo.addWords(80);
    expect((await repo.getToday()).words).toBe(80);
    // il giorno prima è ancora nello storico
    const history = await repo.getHistory(2);
    expect(history).toEqual([
      { date: '2026-09-05', words: 500 },
      { date: '2026-09-06', words: 80 },
    ]);
  });

  it('legge (upgrade-on-read) un payload v1 senza perderlo', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 1, date: '2026-09-05', words: 640 }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-05');
    expect((await repo.getToday()).words).toBe(640);
    // e continuando ad accumulare il dato v1 resta
    await repo.addWords(60);
    expect((await repo.getToday()).words).toBe(700);
  });

  it('alla scrittura pota agli ultimi 35 giorni', async () => {
    const seed: Record<string, number> = {};
    for (let d = 1; d <= 34; d++) seed[`2026-08-${String(d > 31 ? 31 : d).padStart(2, '0')}`] = 10;
    // storico ampio e sparso su più mesi
    const wide: Record<string, number> = {};
    for (let i = 0; i < 40; i++) wide[shiftDateKey('2026-09-10', -i)] = 10;
    const { storage, data } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 2, days: wide }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-10');
    await repo.addWords(5);
    const stored = JSON.parse(data.get(KEY) as string);
    expect(Object.keys(stored.days).length).toBeLessThanOrEqual(35);
    // oggi è tra i tenuti
    expect(stored.days['2026-09-10']).toBe(15);
  });

  it('getHistory zero-riempie i giorni senza scrittura', async () => {
    const { storage } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 2, days: { '2026-09-08': 200, '2026-09-10': 300 } }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-10');
    expect(await repo.getHistory(3)).toEqual([
      { date: '2026-09-08', words: 200 },
      { date: '2026-09-09', words: 0 },
      { date: '2026-09-10', words: 300 },
    ]);
  });

  it('un payload corrotto riparte da zero senza lanciare', async () => {
    const { storage } = memoryStorage({ [KEY]: '{rotto' });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-05');
    expect((await repo.getToday()).words).toBe(0);
    expect(await repo.getHistory(1)).toEqual([{ date: '2026-09-05', words: 0 }]);
  });

  it('getStreak: una serie oltre i 35 giorni sopravvive alla potatura dello storico', async () => {
    // storico legacy lungo (40 giorni consecutivi sopra l'obiettivo, non potato)
    const wide: Record<string, number> = {};
    for (let i = 0; i < 40; i++) wide[shiftDateKey('2026-09-10', -i)] = 600;
    const { storage, data } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 3, days: wide }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-10');

    // prima lettura: la serie coglie tutti i 40 giorni visibili e la persiste
    expect(await repo.getStreak(500)).toBe(40);
    // una scrittura pota lo storico a 35, ma il record della serie resta 40…
    await repo.addWords(50);
    const stored = JSON.parse(data.get(KEY) as string);
    expect(Object.keys(stored.days).length).toBeLessThanOrEqual(35);
    expect(stored.streak.count).toBe(40);
    // …e la rilettura la conferma a 40 (idempotente, nessun doppio conteggio)
    expect(await repo.getStreak(500)).toBe(40);
    expect(await repo.getStreak(500)).toBe(40);
  });

  it('getStreak: migrazione v2 → v3 conserva lo storico e ricostruisce la serie in corso', async () => {
    const days = { '2026-09-08': 600, '2026-09-09': 600, '2026-09-10': 600 };
    const { storage, data } = memoryStorage({
      [KEY]: JSON.stringify({ schemaVersion: 2, days }),
    });
    const repo = new LocalDailyProgressRepository(storage, () => '2026-09-10');

    expect(await repo.getStreak(500)).toBe(3); // serie esistente ricostruita
    const stored = JSON.parse(data.get(KEY) as string);
    expect(stored.schemaVersion).toBe(3);
    expect(stored.days).toEqual(days); // storico non perso
    expect(stored.streak).toEqual({ count: 3, lastGoalMetDate: '2026-09-10' });
  });

  it('getStreak: il giorno dopo, raggiunto l’obiettivo, la serie sale di uno', async () => {
    const days = { '2026-09-09': 600, '2026-09-10': 600 };
    const { storage } = memoryStorage({ [KEY]: JSON.stringify({ schemaVersion: 3, days }) });
    let today = '2026-09-10';
    const repo = new LocalDailyProgressRepository(storage, () => today);
    expect(await repo.getStreak(500)).toBe(2);
    // nuovo giorno: prima nulla di scritto → la serie regge a 2 (giornata in corso)
    today = '2026-09-11';
    expect(await repo.getStreak(500)).toBe(2);
    // scrive e raggiunge l'obiettivo → 3
    await repo.addWords(600);
    expect(await repo.getStreak(500)).toBe(3);
  });
});
