// Modalità E2E: sull'emulatore lo speech-to-text reale non è
// praticabile (niente microfono, spesso niente servizio Google), quindi i
// flussi Maestro girano con il FakeDictationEngine pilotato da uno script a
// tempo. La modalità si accende SOLO avviando Metro con EXPO_PUBLIC_E2E=1
// (variabile inlined nel bundle): l'app di uso normale non passa mai di qui.

import type { PreflightChecks } from '../features/dictation';
import { FakeDictationEngine } from '../features/dictation';

export const isE2E = process.env.EXPO_PUBLIC_E2E === '1';

// Frasi deterministiche: 5 + 6 = 11 parole, il flusso Maestro verifica
// il testo e il contatore «11 parole in questa sessione».
const E2E_SCRIPT = [
  { atMs: 700, type: 'partial', text: 'Il caffè' },
  { atMs: 1400, type: 'final', text: 'Il caffè era ancora caldo.' },
  { atMs: 2300, type: 'partial', text: 'La biblioteca' },
  { atMs: 3000, type: 'final', text: 'La biblioteca profumava di carta antica.' },
] as const;

/** Motore finto che «detta» lo script a ogni start (anche alla ripresa da pausa). */
class ScriptedDictationEngine extends FakeDictationEngine {
  override async start(options: Parameters<FakeDictationEngine['start']>[0]): Promise<void> {
    await super.start(options);
    this.playScript(E2E_SCRIPT);
  }
}

export function createE2EDictationEngine(): FakeDictationEngine {
  return new ScriptedDictationEngine();
}

/** Pre-flight sempre verde: sull'emulatore non ci sono permessi né servizio STT. */
export const e2ePreflightChecks: PreflightChecks = {
  isRecognitionAvailable: () => true,
  getPermissions: async () => ({ granted: true, canAskAgain: true }),
  requestPermissions: async () => ({ granted: true, canAskAgain: true }),
  getSupportedLocales: async () => ({ locales: ['it-IT'], installedLocales: ['it-IT'] }),
  platform: 'android',
};
