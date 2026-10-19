// Logic of the Settings screen: loads the document from the repository,
// persists every change (rare writes: saved immediately, no debounce) and
// keeps the ThemeProvider aligned with the theme preference — including
// "automatic", which follows the system theme.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';

import { resolveLanguage, setLanguage } from '../../i18n';
import { useTheme } from '../../theme';
import type { ThemeMode } from '../../theme';
import type { AiProviderId } from './aiProviders';
import { DAILY_GOAL_MAX, DAILY_GOAL_MIN, DEFAULT_SETTINGS } from './types';
import type {
  AppSettings,
  BackupFrequency,
  SettingsRepository,
  ThemePreference,
  UiLanguagePreference,
} from './types';

/**
 * Translates the saved preference into the ThemeProvider's concrete mode.
 * `systemScheme` is the value of `useColorScheme()` (in RN 0.86 it can also
 * be "unspecified"): only a system "light" scheme gives paper; anything else (dark, unspecified,
 * unknown) gets the app default, black and gold.
 */
export function resolveThemeMode(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): ThemeMode {
  if (preference === 'auto') return systemScheme === 'light' ? 'paper' : 'candlelight';
  return preference;
}

export interface SettingsController {
  /** false until the document has been read from the repository. */
  ready: boolean;
  settings: AppSettings;
  setAiProvider: (id: AiProviderId) => void;
  setThemePreference: (preference: ThemePreference) => void;
  setDailyGoalWords: (words: number) => void;
  setBackupFrequency: (frequency: BackupFrequency) => void;
  /** Records the time of the last successful backup (visual reminder). */
  setLastBackupAt: (at: number) => void;
  /** Saves the interface language and switches the UI to it right away. */
  setUiLanguage: (preference: UiLanguagePreference) => void;
}

export function useSettingsController(repository: SettingsRepository): SettingsController {
  const { setMode } = useTheme();
  const systemScheme = useColorScheme();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    let cancelled = false;
    repository
      .load()
      // a read error does not block the screen: start again from the defaults
      .catch(() => DEFAULT_SETTINGS)
      .then((loaded) => {
        if (cancelled) return;
        settingsRef.current = loaded;
        setSettings(loaded);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // the theme follows the preference (and the system, when "automatic")
  useEffect(() => {
    if (!ready) return;
    setMode(resolveThemeMode(settings.theme, systemScheme));
  }, [ready, settings.theme, systemScheme, setMode]);

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      repository.save(next).catch((error) => {
        // settings stay valid in memory; at the next launch we
        // will restart from the last successful save
        console.warn('Saving settings failed', error);
      });
    },
    [repository],
  );

  const setAiProvider = useCallback((id: AiProviderId) => update({ aiProvider: id }), [update]);
  const setThemePreference = useCallback(
    (preference: ThemePreference) => update({ theme: preference, themeChosen: true }),
    [update],
  );
  const setDailyGoalWords = useCallback(
    (words: number) => {
      const clamped = Math.min(DAILY_GOAL_MAX, Math.max(DAILY_GOAL_MIN, Math.round(words)));
      update({ dailyGoalWords: clamped });
    },
    [update],
  );
  const setBackupFrequency = useCallback(
    (frequency: BackupFrequency) => update({ backupFrequency: frequency }),
    [update],
  );
  const setLastBackupAt = useCallback((at: number) => update({ lastBackupAt: at }), [update]);
  const setUiLanguage = useCallback(
    (preference: UiLanguagePreference) => {
      update({ uiLanguage: preference });
      setLanguage(resolveLanguage(preference));
    },
    [update],
  );

  return {
    ready,
    settings,
    setAiProvider,
    setThemePreference,
    setDailyGoalWords,
    setBackupFrequency,
    setLastBackupAt,
    setUiLanguage,
  };
}
