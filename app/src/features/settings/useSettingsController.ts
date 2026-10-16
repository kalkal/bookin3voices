// Logica della schermata Impostazioni: carica il documento dal repository,
// persiste ogni modifica (scritture rare: si salva subito, senza debounce) e
// tiene il ThemeProvider allineato alla preferenza di tema — compreso
// "automatico", che segue il tema di sistema.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';

import { useTheme } from '../../theme';
import type { ThemeMode } from '../../theme';
import type { AiProviderId } from './aiProviders';
import { DAILY_GOAL_MAX, DAILY_GOAL_MIN, DEFAULT_SETTINGS } from './types';
import type { AppSettings, BackupFrequency, SettingsRepository, ThemePreference } from './types';

/**
 * Traduce la preferenza salvata nel modo concreto del ThemeProvider.
 * `systemScheme` è il valore di `useColorScheme()` (in RN 0.86 può anche
 * essere "unspecified"): tutto ciò che non è "dark" cade sulla carta.
 */
export function resolveThemeMode(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): ThemeMode {
  if (preference === 'auto') return systemScheme === 'dark' ? 'candlelight' : 'paper';
  return preference;
}

export interface SettingsController {
  /** false finché il documento non è stato letto dal repository. */
  ready: boolean;
  settings: AppSettings;
  setAiProvider: (id: AiProviderId) => void;
  setThemePreference: (preference: ThemePreference) => void;
  setDailyGoalWords: (words: number) => void;
  setBackupFrequency: (frequency: BackupFrequency) => void;
  /** Registra l'istante dell'ultimo backup riuscito (promemoria visivo). */
  setLastBackupAt: (at: number) => void;
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
      // un errore di lettura non blocca la schermata: si riparte dai default
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

  // il tema segue la preferenza (e il sistema, quando è "automatico")
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
        // le impostazioni restano valide in memoria; al prossimo avvio si
        // ripartirà dall'ultimo salvataggio riuscito
        console.warn('Salvataggio impostazioni non riuscito', error);
      });
    },
    [repository],
  );

  const setAiProvider = useCallback((id: AiProviderId) => update({ aiProvider: id }), [update]);
  const setThemePreference = useCallback(
    (preference: ThemePreference) => update({ theme: preference }),
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

  return {
    ready,
    settings,
    setAiProvider,
    setThemePreference,
    setDailyGoalWords,
    setBackupFrequency,
    setLastBackupAt,
  };
}
