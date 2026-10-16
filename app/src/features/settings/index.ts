// Public API of the Settings feature.
// The AiProvider catalog is meant to be reused by the Functions.

export {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  DEFAULT_AI_PROVIDER_ID,
  isAiProviderId,
} from './aiProviders';
export type { AiProviderId, AiProviderInfo, AiProviderTier } from './aiProviders';
export {
  appSettingsSchema,
  BACKUP_FREQUENCIES,
  DAILY_GOAL_MAX,
  DAILY_GOAL_MIN,
  DAILY_GOAL_STEP,
  DEFAULT_SETTINGS,
  THEME_PREFERENCES,
  UI_LANGUAGES,
} from './types';
export type {
  AppSettings,
  BackupFrequency,
  SettingsRepository,
  ThemePreference,
  UiLanguagePreference,
} from './types';
export {
  BACKUP_FREQUENCY_DAYS,
  backupFileSchema,
  backupStatus,
  InMemoryBackupService,
} from './backup';
export type { BackupFile, BackupRequest, BackupService, BackupStatus } from './backup';
export { CallableBackupService } from './CallableBackupService';
export { LocalSettingsRepository } from './LocalSettingsRepository';
export { resolveThemeMode, useSettingsController } from './useSettingsController';
export type { SettingsController } from './useSettingsController';
export { SettingsScreen } from './SettingsScreen';
export type { SettingsScreenProps } from './SettingsScreen';
