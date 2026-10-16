// Settings contract (Repository pattern): the UI never
// imports the persistence SDK. The structure mirrors the
// `settings/app` document; the Firestore integration will replace the local implementation
// with Firestore WITHOUT touching the screens.

import { z } from 'zod';

import { AI_PROVIDER_IDS, DEFAULT_AI_PROVIDER_ID } from './aiProviders';

/** Theme preference: paper, candlelight, or automatic. */
export const THEME_PREFERENCES = ['paper', 'candlelight', 'auto'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Frequency of the Markdown backup (the real export arrives with the Backup feature). */
export const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

/** Limits of the daily word goal (Settings screen). */
export const DAILY_GOAL_MIN = 100;
export const DAILY_GOAL_MAX = 10_000;
export const DAILY_GOAL_STEP = 100;

// external data (disk today, Firestore tomorrow) validated at the boundary with Zod
export const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  aiProvider: z.enum(AI_PROVIDER_IDS),
  theme: z.enum(THEME_PREFERENCES),
  dailyGoalWords: z.number().int().min(DAILY_GOAL_MIN).max(DAILY_GOAL_MAX),
  backupFrequency: z.enum(BACKUP_FREQUENCIES),
  /**
   * When the last backup was downloaded, epoch ms; null = never.
   * `default` and not a required field: payloads saved before the Backup feature do not
   * have it and must NOT fall back to DEFAULT_SETTINGS.
   */
  lastBackupAt: z.number().int().positive().nullable().default(null),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

/**
 * Starting values of the `settings/app` doc: Amazon Nova (bedrock) is the
 * DEFAULT provider; the app's default theme is paper.
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
   * Current settings; if nothing was ever saved (or the payload is not
   * readable) DEFAULT_SETTINGS is returned — settings can always be
   * rebuilt, unlike dictated text.
   */
  load(): Promise<AppSettings>;
  /** Replaces the whole settings document. */
  save(settings: AppSettings): Promise<void>;
}
