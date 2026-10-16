// Contratto delle impostazioni (Repository pattern): la UI non
// importa mai l'SDK di persistenza. La struttura rispecchia il documento
// `settings/app`; l'integrazione Firestore sostituirà l'implementazione locale
// con Firestore SENZA toccare le schermate.

import { z } from 'zod';

import { AI_PROVIDER_IDS, DEFAULT_AI_PROVIDER_ID } from './aiProviders';

/** Preferenza di tema: carta, a lume di candela, o automatico. */
export const THEME_PREFERENCES = ['paper', 'candlelight', 'auto'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Frequenza del backup Markdown (l'export vero arriva con la feature Backup). */
export const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

/** Limiti dell'obiettivo parole giornaliero (schermata Impostazioni). */
export const DAILY_GOAL_MIN = 100;
export const DAILY_GOAL_MAX = 10_000;
export const DAILY_GOAL_STEP = 100;

// dati esterni (disco oggi, Firestore domani) validati al confine con Zod
export const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  aiProvider: z.enum(AI_PROVIDER_IDS),
  theme: z.enum(THEME_PREFERENCES),
  dailyGoalWords: z.number().int().min(DAILY_GOAL_MIN).max(DAILY_GOAL_MAX),
  backupFrequency: z.enum(BACKUP_FREQUENCIES),
  /**
   * Quando è stato scaricato l'ultimo backup, epoch ms; null = mai.
   * `default` e non campo obbligatorio: i payload salvati prima della feature Backup non
   * ce l'hanno e NON devono decadere ai DEFAULT_SETTINGS.
   */
  lastBackupAt: z.number().int().positive().nullable().default(null),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

/**
 * Valori di partenza del doc `settings/app`: Gemini è il provider
 * DEFAULT; il tema di default dell'app è la carta.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  aiProvider: DEFAULT_AI_PROVIDER_ID,
  theme: 'paper',
  dailyGoalWords: 500,
  backupFrequency: 'weekly',
  lastBackupAt: null,
};

export interface SettingsRepository {
  /**
   * Impostazioni correnti; se non è mai stato salvato nulla (o il payload non
   * è leggibile) tornano i DEFAULT_SETTINGS — le impostazioni sono sempre
   * ricostruibili, a differenza del testo dettato.
   */
  load(): Promise<AppSettings>;
  /** Sostituisce per intero il documento impostazioni. */
  save(settings: AppSettings): Promise<void>;
}
