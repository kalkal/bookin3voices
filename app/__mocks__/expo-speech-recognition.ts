// Mock automatico di expo-speech-recognition per Jest (il modulo nativo non
// esiste in ambiente di test). Scenario di default: tutto disponibile, permessi
// concessi, italiano installato per l'offline. I test che vogliono altri
// scenari iniettano i propri fake (SpeechModule, PreflightChecks) — questo
// mock serve solo a far montare l'albero senza motore nativo.

export const ExpoSpeechRecognitionModule = {
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  start: jest.fn(),
  stop: jest.fn(),
  isRecognitionAvailable: jest.fn(() => true),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  getSupportedLocales: jest.fn(async () => ({
    locales: ['it-IT'],
    installedLocales: ['it-IT'],
  })),
  androidTriggerOfflineModelDownload: jest.fn(async () => ({
    status: 'download_success',
    message: '',
  })),
};
