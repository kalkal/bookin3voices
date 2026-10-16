// Session-start pre-flight: checks microphone permission, recognition
// availability and the offline language pack, with clear messages BEFORE the
// user faces a silent engine.
// The logic is pure and receives the checks as an injectable dependency: the UI
// uses createNativePreflightChecks(), tests pass a fake.

import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import { t } from '../../i18n';

export interface PreflightChecks {
  isRecognitionAvailable(): boolean;
  getPermissions(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissions(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  /** Languages of the recognition service; `installedLocales` = offline use. */
  getSupportedLocales(): Promise<{ locales: string[]; installedLocales: string[] }>;
  platform: typeof Platform.OS;
}

export type PreflightIssueId =
  'recognition-unavailable' | 'permission-denied' | 'offline-language-missing';

/** Action offered to the user next to the message. */
export type PreflightAction = 'open-settings' | 'download-offline-model';

export interface PreflightIssue {
  id: PreflightIssueId;
  /** blocker = no dictation; warning = dictation works, with a known risk. */
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  action?: PreflightAction;
}

export interface PreflightReport {
  /** true if there are no blockers (warnings do not stop dictation). */
  ok: boolean;
  issues: PreflightIssue[];
}

export async function runPreflight(
  checks: PreflightChecks,
  lang = 'it-IT',
): Promise<PreflightReport> {
  const issues: PreflightIssue[] = [];

  if (!checks.isRecognitionAvailable()) {
    issues.push({
      id: 'recognition-unavailable',
      severity: 'blocker',
      title: t('dictation.preflight.unavailable.title'),
      detail: t('dictation.preflight.unavailable.detail'),
    });
    // without the service, the other checks make no sense
    return { ok: false, issues };
  }

  let permission = await checks.getPermissions();
  if (!permission.granted) {
    permission = await checks.requestPermissions();
  }
  if (!permission.granted) {
    issues.push({
      id: 'permission-denied',
      severity: 'blocker',
      title: t('dictation.preflight.permission.title'),
      detail: permission.canAskAgain
        ? t('dictation.preflight.permission.retry')
        : t('dictation.preflight.permission.permanent'),
      action: permission.canAskAgain ? undefined : 'open-settings',
    });
    return { ok: false, issues };
  }

  // offline language pack: a reliable signal only on Android 13+ with the
  // Google service; if the list is unreadable we stay silent (no false
  // alarm). The check does not apply on iOS.
  if (checks.platform === 'android') {
    try {
      const { installedLocales } = await checks.getSupportedLocales();
      const wanted = normalizeLocale(lang);
      const installed = installedLocales.some((l) => normalizeLocale(l) === wanted);
      if (installedLocales.length > 0 && !installed) {
        issues.push({
          id: 'offline-language-missing',
          severity: 'warning',
          title: t('dictation.preflight.offline.title'),
          detail: t('dictation.preflight.offline.detail'),
          action: 'download-offline-model',
        });
      }
    } catch {
      // service that does not expose languages: no signal, no warning
    }
  }

  return { ok: issues.every((issue) => issue.severity !== 'blocker'), issues };
}

const normalizeLocale = (locale: string) => locale.replace('_', '-').toLowerCase();

/** Real checks on expo-speech-recognition (used by the screen). */
export function createNativePreflightChecks(): PreflightChecks {
  return {
    isRecognitionAvailable: () => ExpoSpeechRecognitionModule.isRecognitionAvailable(),
    getPermissions: () => ExpoSpeechRecognitionModule.getPermissionsAsync(),
    requestPermissions: () => ExpoSpeechRecognitionModule.requestPermissionsAsync(),
    getSupportedLocales: () => ExpoSpeechRecognitionModule.getSupportedLocales({}),
    platform: Platform.OS,
  };
}

/**
 * Starts the offline model download for the language (Android 13+).
 * Fire-and-forget from the UI's point of view: when it finishes, the
 * pre-flight can be rerun to clear the warning.
 */
export async function downloadOfflineModel(lang = 'it-IT'): Promise<void> {
  await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: lang });
}
