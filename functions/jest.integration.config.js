// Test d'INTEGRAZIONE della callable exportBook contro l'emulatore Firestore
// (MAI contro progetti Firebase reali). Prerequisiti:
//  - emulatore Firestore attivo — `firebase emulators:exec` imposta da sé
//    FIRESTORE_EMULATOR_HOST; il test rifiuta di partire senza;
//  - per la validazione EPUB serve EPUBCheck (jar) + Java 11+: percorso jar
//    via env EPUBCHECK_JAR (in locale c'è il default della toolchain portable).

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // niente <rootDir> nel pattern: su Windows (git worktrees nested in hidden dirs) i
  // backslash del percorso vengono letti come escape dal glob e non matcha più
  testMatch: ['**/src/__integration__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { rootDir: '.' } }],
  },
  testTimeout: 120000,
};
