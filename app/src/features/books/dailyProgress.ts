// Diario dei progressi (alla Werdsmith "in versione leggera"):
// contatore LOCALE delle parole aggiunte, alimentato dai salvataggi del
// capitolo (OfflineFirstChapterRepository.onWordsAdded). Vive su AsyncStorage
// e non su Firestore: è un dato motivazionale del dispositivo, non fa parte
// del libro — perderlo non è un bug, sporcarlo col sync sì.
//
// Schema v2: oltre al giorno corrente teniamo uno STORICO breve
// (days{ 'YYYY-MM-DD': parole }) per alimentare serie e grafico settimanale.
// Un payload v1 { date, words } viene migrato al volo (upgrade-on-read) così
// da non perdere mai il conteggio già maturato; alla scrittura lo storico si
// pota agli ultimi ~35 giorni (quanto basta a settimana + grafico, senza
// gonfiare il disco).
//
// Schema v3: la SERIE (giorni di fila sopra l'obiettivo) non deve avere il tetto
// della potatura — una feature motivazionale non può congelare a 35 chi scrive
// da 40 giorni. Il problema è che lo storico `days` è potato, quindi contare la
// serie solo da lì la limita alla finestra. Perciò teniamo a parte un record NON
// potato `streak { count, lastGoalMetDate }` e lo RICONCILIAMO alla lettura, là
// dove l'obiettivo (che vive nelle Impostazioni, non qui) e le parole di oggi
// sono noti: così il contatore sopravvive alla potatura e può salire senza
// limite. `days` resta potato per settimana e grafico. Migrazione v1/v2 → v3
// upgrade-on-read puro: mai perdere né lo storico né una serie in corso (viene
// ricostruita dallo storico visibile alla prima riconciliazione).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { KeyValueStorage } from '../chapters';

const STORAGE_KEY = 'bookvoice/daily-progress';

/** Giorni di storico tenuti su disco: settimana + margine per la serie. */
export const MAX_HISTORY_DAYS = 35;

// dati esterni (disco) validati al confine con Zod (standard tecnici)
const storedProgressV1Schema = z.object({
  schemaVersion: z.literal(1),
  /** Giorno locale in formato YYYY-MM-DD. */
  date: z.string(),
  words: z.number().int().min(0),
});

const storedProgressV2Schema = z.object({
  schemaVersion: z.literal(2),
  /** Parole per giorno locale (YYYY-MM-DD → conteggio). */
  days: z.record(z.string(), z.number().int().min(0)),
});

/**
 * Serie persistita, FUORI dal record potato: `count` giorni consecutivi sopra
 * l'obiettivo terminanti in `lastGoalMetDate` (null = nessuna serie in corso).
 * Tenendo la data reale dell'ultimo giorno raggiunto, un buco si rileva ANCHE
 * oltre i 35 giorni di storico.
 */
const streakRecordSchema = z.object({
  count: z.number().int().min(0),
  lastGoalMetDate: z.string().nullable(),
});

const storedProgressV3Schema = z.object({
  schemaVersion: z.literal(3),
  days: z.record(z.string(), z.number().int().min(0)),
  /** Assente sui payload appena migrati: la serie si semina alla prima lettura. */
  streak: streakRecordSchema.optional(),
});

export type StreakRecord = z.infer<typeof streakRecordSchema>;
export type StoredProgress = z.infer<typeof storedProgressV3Schema>;

export interface DailyProgress {
  date: string;
  words: number;
}

export interface DailyProgressRepository {
  /** Parole aggiunte oggi; riparte da zero al cambio di giorno. */
  getToday(): Promise<DailyProgress>;
  /** Somma parole aggiunte (i delta negativi vengono ignorati). */
  addWords(delta: number): Promise<void>;
  /** Ultimi `nDays` giorni fino a oggi, dal più vecchio, con zero-fill dei buchi. */
  getHistory(nDays: number): Promise<DailyProgress[]>;
  /**
   * Serie corrente (giorni di fila sopra `goalWords`), riconciliata e persistita
   * col contatore non potato: sale senza il tetto dei 35 giorni. L'obiettivo
   * arriva dalle Impostazioni, che questo storage non conosce, perciò va passato.
   */
  getStreak(goalWords: number): Promise<number>;
}

/** Chiave del giorno LOCALE (l'obiettivo segue l'orologio di chi scrive). */
export function localDateKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Sposta una chiave-giorno di `delta` giorni gestendo i confini di mese/anno.
 * Costruisce la data dai componenti (mezzanotte locale) per non incappare nei
 * fusi orari del parsing ISO.
 */
export function shiftDateKey(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + delta);
  return localDateKey(date);
}

/**
 * Porta qualunque payload salvato allo schema v3 senza perdere il dato: un v3
 * valido (storico + serie) passa intatto; un v2 diventa v3 conservando `days`
 * (la serie si ricostruisce dallo storico alla prima riconciliazione); un v1
 * { date, words } diventa { days: { [date]: words } }; tutto il resto (corrotto,
 * sconosciuto) diventa storico vuoto. Funzione pura: il confine con Zod la rende
 * testabile al 100%.
 */
export function upgradeStoredProgress(raw: unknown): StoredProgress {
  const v3 = storedProgressV3Schema.safeParse(raw);
  if (v3.success) return v3.data;
  const v2 = storedProgressV2Schema.safeParse(raw);
  if (v2.success) return { schemaVersion: 3, days: v2.data.days };
  const v1 = storedProgressV1Schema.safeParse(raw);
  if (v1.success) return { schemaVersion: 3, days: { [v1.data.date]: v1.data.words } };
  return { schemaVersion: 3, days: {} };
}

/** Tiene solo gli ultimi `keep` giorni registrati (le date ISO ordinano nel tempo). */
export function pruneDays(
  days: Record<string, number>,
  keep: number = MAX_HISTORY_DAYS,
): Record<string, number> {
  const keys = Object.keys(days).sort();
  if (keys.length <= keep) return days;
  const kept = keys.slice(keys.length - keep);
  const out: Record<string, number> = {};
  for (const key of kept) out[key] = days[key];
  return out;
}

/**
 * Serie giornaliera: `nDays` giorni fino a `today`, dal più vecchio al più
 * recente, con i giorni senza scrittura a zero. Pura: la UI ci disegna barre e
 * spunte senza sapere nulla dello storage.
 */
export function buildHistory(
  days: Record<string, number>,
  nDays: number,
  today: string,
): DailyProgress[] {
  const history: DailyProgress[] = [];
  for (let offset = nDays - 1; offset >= 0; offset--) {
    const date = shiftDateKey(today, -offset);
    history.push({ date, words: days[date] ?? 0 });
  }
  return history;
}

/**
 * Serie (streak) = numero di giorni CONSECUTIVI con parole >= obiettivo, contati
 * all'indietro da oggi. Scelta di prodotto (default dichiarato): "raggiungi
 * l'obiettivo", non "almeno scritto qualcosa". Oggi ancora sotto l'obiettivo NON
 * azzera la serie — la giornata è in corso: si guarda a partire da ieri. Un
 * obiettivo non valido (<= 0) non produce serie (evita anche il ciclo infinito).
 */
export function computeStreak(
  days: Record<string, number>,
  goalWords: number,
  today: string,
): number {
  if (goalWords <= 0) return 0;
  const reached = (key: string) => (days[key] ?? 0) >= goalWords;

  // giornata in corso: se oggi non è (ancora) raggiunto, si parte da ieri
  let cursor = reached(today) ? today : shiftDateKey(today, -1);
  let streak = 0;
  while (reached(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

/** Giorni interi tra due chiavi-giorno: shiftDateKey(from, daysBetween(from,to)) === to. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  // mezzanotte UTC di entrambi: due punti a distanza di giorni interi, immuni al DST
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Riconcilia la serie persistita col contatore NON potato: la fa salire oltre i
 * 35 giorni sopravvivendo alla potatura di `days`, restando idempotente per
 * giorno. Pura (nessun IO): il repository la avvolge leggendo/scrivendo.
 *
 * `computeStreak` sullo storico visibile è ESATTO per le serie che ci stanno
 * dentro (buchi inclusi) e si ferma al bordo della finestra quando la satura:
 * lì subentra il record, che ricorda la parte più vecchia della finestra. Il
 * record ESTENDE la serie solo se è contiguo alla corsa visibile (la sua
 * `lastGoalMetDate` tocca la finestra): così un buco reale — anche oltre i 35
 * giorni — stacca il record e la serie RIPARTE. Avanzando il record di tutti i
 * giorni consecutivi fino a oggi (non solo +1 da ieri) regge anche se la lettura
 * salta qualche giorno pur avendo scritto ogni giorno.
 *
 * Decisioni di prodotto dichiarate:
 * - Cambio obiettivo: la serie NON si ricalcola retroattivamente. Entro la
 *   finestra visibile conta il nuovo obiettivo (un giorno recente che non lo
 *   raggiunge più spezza la corsa); la parte oltre la finestra resta col
 *   conteggio maturato allora — un giorno passato raggiunto con un altro
 *   obiettivo resta contato, non si riscrive la storia.
 * - Idempotenza: rileggere lo stesso giorno non incrementa (delta 0 quando
 *   `lastGoalMetDate` è già oggi).
 */
export function reconcileStreak(
  stored: StreakRecord | null,
  days: Record<string, number>,
  goalWords: number,
  today: string,
): StreakRecord {
  if (goalWords <= 0) return { count: 0, lastGoalMetDate: null };
  const reached = (key: string) => (days[key] ?? 0) >= goalWords;

  // ultimo giorno che conta per la corsa in essere (oggi, o ieri se oggi è in corso)
  const anchor = reached(today) ? today : shiftDateKey(today, -1);
  if (!reached(anchor)) return { count: 0, lastGoalMetDate: null };

  // lunghezza provata dallo storico visibile (esatta ≤ finestra, satura al bordo)
  const windowStreak = computeStreak(days, goalWords, today);
  const earliestVisible = shiftDateKey(anchor, -(windowStreak - 1));
  const edge = shiftDateKey(earliestVisible, -1); // giorno appena prima della corsa visibile

  // Il record ESTENDE solo attraverso l'orizzonte di potatura: se `edge` esiste
  // nello storico (quindi la corsa si è fermata su un giorno NON raggiunto, non
  // per mancanza di dati) la serie è finita lì e il record non la allunga —
  // così alzare l'obiettivo la spezza dentro la finestra, senza riscrivere la
  // storia oltre di essa.
  const prunedBeyondWindow = days[edge] === undefined;
  const last = stored?.lastGoalMetDate ?? null;
  if (stored !== null && last !== null && prunedBeyondWindow && last <= anchor && last >= edge) {
    // il record copre fino a `last`; i giorni fino ad `anchor` sono nella corsa
    const extended = stored.count + Math.max(0, daysBetween(last, anchor));
    return { count: Math.max(extended, windowStreak), lastGoalMetDate: anchor };
  }
  // nessun record utile (assente o staccato da un buco): vale la finestra visibile
  return { count: windowStreak, lastGoalMetDate: anchor };
}

export class LocalDailyProgressRepository implements DailyProgressRepository {
  private readonly storage: KeyValueStorage;
  private readonly today: () => string;

  constructor(storage: KeyValueStorage = AsyncStorage, today: () => string = localDateKey) {
    this.storage = storage;
    this.today = today;
  }

  /** Legge lo storico dal disco portandolo allo schema v3 (mai lanciando). */
  private async readStored(): Promise<StoredProgress> {
    const raw = await this.storage.getItem(STORAGE_KEY);
    if (raw === null) return { schemaVersion: 3, days: {} };
    try {
      return upgradeStoredProgress(JSON.parse(raw));
    } catch {
      // JSON illeggibile: dato motivazionale ricostruibile, si riparte pulito
      return { schemaVersion: 3, days: {} };
    }
  }

  /** Persiste storico + serie in un colpo solo, sempre allo schema corrente. */
  private async writeStored(days: Record<string, number>, streak?: StreakRecord): Promise<void> {
    const payload: StoredProgress = { schemaVersion: 3, days };
    if (streak !== undefined) payload.streak = streak;
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  async getToday(): Promise<DailyProgress> {
    const date = this.today();
    const stored = await this.readStored();
    return { date, words: stored.days[date] ?? 0 };
  }

  async addWords(delta: number): Promise<void> {
    const rounded = Math.round(delta);
    if (rounded <= 0) return;
    const date = this.today();
    const stored = await this.readStored();
    const days = pruneDays({ ...stored.days, [date]: (stored.days[date] ?? 0) + rounded });
    // la serie non si tocca qui (non conosciamo l'obiettivo) ma va conservata,
    // altrimenti la potatura la perderebbe: si riconcilia alla lettura
    await this.writeStored(days, stored.streak);
  }

  async getHistory(nDays: number): Promise<DailyProgress[]> {
    const stored = await this.readStored();
    return buildHistory(stored.days, nDays, this.today());
  }

  async getStreak(goalWords: number): Promise<number> {
    const stored = await this.readStored();
    const streak = reconcileStreak(stored.streak ?? null, stored.days, goalWords, this.today());
    // riconciliazione persistente: il contatore non potato sopravvive e cresce
    await this.writeStored(stored.days, streak);
    return streak.count;
  }
}
