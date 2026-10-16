// E2E mode: on the emulator real speech-to-text is not practical (no
// microphone, often no Google service), so the Maestro flows run with the
// FakeDictationEngine driven by a timed script. The mode is turned on ONLY by
// starting Metro with EXPO_PUBLIC_E2E=1 (variable inlined in the bundle): the
// normal app never goes through here.

import type { PreflightChecks } from '../features/dictation';
import { FakeDictationEngine } from '../features/dictation';

export const isE2E = process.env.EXPO_PUBLIC_E2E === '1';

// Deterministic phrases: 5 + 6 = 11 words, the Maestro flow checks
// the text and the counter «11 parole in questa sessione».
const E2E_SCRIPT = [
  { atMs: 700, type: 'partial', text: 'Il caffè' },
  { atMs: 1400, type: 'final', text: 'Il caffè era ancora caldo.' },
  { atMs: 2300, type: 'partial', text: 'La biblioteca' },
  { atMs: 3000, type: 'final', text: 'La biblioteca profumava di carta antica.' },
] as const;

/** Fake engine that «dictates» the script on every start (also when resuming from pause). */
class ScriptedDictationEngine extends FakeDictationEngine {
  override async start(options: Parameters<FakeDictationEngine['start']>[0]): Promise<void> {
    await super.start(options);
    this.playScript(E2E_SCRIPT);
  }
}

export function createE2EDictationEngine(): FakeDictationEngine {
  return new ScriptedDictationEngine();
}

/** Always-green pre-flight: the emulator has neither permissions nor an STT service. */
export const e2ePreflightChecks: PreflightChecks = {
  isRecognitionAvailable: () => true,
  getPermissions: async () => ({ granted: true, canAskAgain: true }),
  requestPermissions: async () => ({ granted: true, canAskAgain: true }),
  getSupportedLocales: async () => ({ locales: ['it-IT'], installedLocales: ['it-IT'] }),
  platform: 'android',
};
