// Test d'INTEGRAZIONE contro l'Emulator Suite: girano in Node puro
// (niente jest-expo: i repository Firestore non toccano React Native) e SOLO
// contro l'emulatore — @firebase/rules-unit-testing rifiuta di parlare col
// cloud (MAI test contro progetti Firebase reali).
//
// Prerequisito: emulatore Firestore attivo (npm run emulators dalla cartella
// app/, oppure `firebase emulators:exec` che imposta FIRESTORE_EMULATOR_HOST).
// `npm test` NON esegue questi file (testPathIgnorePatterns in package.json).

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // niente <rootDir> nel pattern: su Windows (git worktrees nested in hidden dirs) i
  // backslash del percorso vengono letti come escape dal glob e non matcha più
  testMatch: ['**/__integration__/**/*.test.ts'],
  transform: {
    // stesso preset babel che jest-expo usa per l'app (babel-preset-expo non è
    // una dipendenza diretta: lo espone expo/internal)
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: [require.resolve('expo/internal/babel-preset')] }],
  },
  // i pacchetti firebase in Node arrivano già in CJS: niente da trasformare
  testTimeout: 20000,
};
