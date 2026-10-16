// Unit tests of the functions (pure logic + exporter, no emulator).
// The tests in __integration__ require the Firestore emulator and run with
// jest.integration.config.js (npm run test:integration, under emulators:exec).

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // no <rootDir> in the pattern: on Windows (git worktrees nested in hidden dirs) the
  // path backslashes are read as escapes by the glob and it no longer matches
  testMatch: ['**/src/**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { rootDir: '.' } }],
  },
  testTimeout: 30000,
};
