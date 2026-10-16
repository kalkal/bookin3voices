// INTEGRATION tests against the Emulator Suite: they run in plain Node
// (no jest-expo: the Firestore repositories do not touch React Native) and ONLY
// against the emulator — @firebase/rules-unit-testing refuses to talk to the
// cloud (NEVER test against real Firebase projects).
//
// Prerequisite: Firestore emulator running (npm run emulators from the
// app/ folder, or `firebase emulators:exec` which sets FIRESTORE_EMULATOR_HOST).
// `npm test` does NOT run these files (testPathIgnorePatterns in package.json).

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // no <rootDir> in the pattern: on Windows (git worktrees nested in hidden dirs) the
  // path backslashes are read as escapes by the glob and it no longer matches
  testMatch: ['**/__integration__/**/*.test.ts'],
  transform: {
    // same babel preset that jest-expo uses for the app (babel-preset-expo is not
    // a direct dependency: expo/internal exposes it)
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: [require.resolve('expo/internal/babel-preset')] }],
  },
  // firebase packages in Node already come as CJS: nothing to transform. The only
  // exception is Expo's ESM env shim, which babel-preset-expo injects for
  // process.env.EXPO_PUBLIC_* reads (e.g. the UI language override in src/i18n).
  transformIgnorePatterns: ['/node_modules/(?!expo/virtual/)'],
  testTimeout: 20000,
};
