// Pre-flight di inizio sessione: verifica permesso microfono,
// disponibilità del riconoscimento e pacchetto lingua offline, con messaggi
// chiari PRIMA che l'utente si trovi davanti a un motore che tace.
// La logica è pura e riceve i controlli come dipendenza iniettabile: la UI usa
// createNativePreflightChecks(), i test passano un fake.

import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

export interface PreflightChecks {
  isRecognitionAvailable(): boolean;
  getPermissions(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestPermissions(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  /** Lingue del servizio di riconoscimento; `installedLocales` = uso offline. */
  getSupportedLocales(): Promise<{ locales: string[]; installedLocales: string[] }>;
  platform: typeof Platform.OS;
}

export type PreflightIssueId =
  'recognition-unavailable' | 'permission-denied' | 'offline-language-missing';

/** Azione proposta all'utente accanto al messaggio. */
export type PreflightAction = 'open-settings' | 'download-offline-model';

export interface PreflightIssue {
  id: PreflightIssueId;
  /** blocker = niente dettatura; warning = si detta, ma con un rischio noto. */
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  action?: PreflightAction;
}

export interface PreflightReport {
  /** true se non ci sono blocker (i warning non fermano la dettatura). */
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
      title: 'Riconoscimento vocale non disponibile',
      detail:
        'Questo dispositivo non ha un servizio di riconoscimento vocale attivo. ' +
        'Su Android serve l’app Google (o i servizi vocali del produttore).',
    });
    // senza servizio, gli altri controlli non hanno senso
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
      title: 'Permesso microfono negato',
      detail: permission.canAskAgain
        ? 'Senza il permesso del microfono non si può dettare. Riprova e concedilo.'
        : 'Il permesso è stato negato in modo permanente: concedilo dalle impostazioni di sistema.',
      action: permission.canAskAgain ? undefined : 'open-settings',
    });
    return { ok: false, issues };
  }

  // pacchetto lingua offline: segnale affidabile solo su Android 13+ con il
  // servizio Google; se la lista non è leggibile si resta in silenzio (nessun
  // falso allarme). Su iOS il controllo non si applica.
  if (checks.platform === 'android') {
    try {
      const { installedLocales } = await checks.getSupportedLocales();
      const wanted = normalizeLocale(lang);
      const installed = installedLocales.some((l) => normalizeLocale(l) === wanted);
      if (installedLocales.length > 0 && !installed) {
        issues.push({
          id: 'offline-language-missing',
          severity: 'warning',
          title: 'Italiano offline non installato',
          detail:
            'Senza rete la dettatura si interrompe: il riconoscimento userà il cloud. ' +
            'Puoi scaricare il pacchetto lingua per dettare anche offline.',
          action: 'download-offline-model',
        });
      }
    } catch {
      // servizio che non espone le lingue: nessun segnale, nessun avviso
    }
  }

  return { ok: issues.every((issue) => issue.severity !== 'blocker'), issues };
}

const normalizeLocale = (locale: string) => locale.replace('_', '-').toLowerCase();

/** Controlli reali su expo-speech-recognition (usati dalla schermata). */
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
 * Avvia il download del modello offline per la lingua (Android 13+).
 * Fire-and-forget dal punto di vista della UI: al termine si può rieseguire
 * il pre-flight per far sparire l'avviso.
 */
export async function downloadOfflineModel(lang = 'it-IT'): Promise<void> {
  await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: lang });
}
