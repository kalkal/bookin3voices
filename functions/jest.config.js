// Unit test delle functions (logica pura + exporter, nessun emulatore).
// I test in __integration__ richiedono l'emulatore Firestore e girano con
// jest.integration.config.js (npm run test:integration, sotto emulators:exec).

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // niente <rootDir> nel pattern: su Windows (git worktrees nested in hidden dirs) i
  // backslash del percorso vengono letti come escape dal glob e non matcha più
  testMatch: ['**/src/**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { rootDir: '.' } }],
  },
  testTimeout: 30000,
};
