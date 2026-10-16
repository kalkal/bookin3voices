// Automatic expo-speech-recognition mock for Jest (the native module does not
// exist in the test environment). Default scenario: everything available, permissions
// granted, Italian installed for offline. Tests that want other
// scenarios inject their own fakes (SpeechModule, PreflightChecks) — this
// mock only serves to mount the tree without a native engine.

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
