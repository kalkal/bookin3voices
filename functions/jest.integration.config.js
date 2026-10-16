// INTEGRATION tests of the exportBook callable against the Firestore emulator
// (NEVER against real Firebase projects). Prerequisites:
//  - Firestore emulator running — `firebase emulators:exec` sets
//    FIRESTORE_EMULATOR_HOST itself; the test refuses to start without it;
//  - EPUB validation needs EPUBCheck (jar) + Java 11+: jar path
//    via env EPUBCHECK_JAR (locally the portable toolchain's default applies).

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // no <rootDir> in the pattern: on Windows (git worktrees nested in hidden dirs) the
  // path backslashes are read as escapes by the glob and it no longer matches
  testMatch: ['**/src/__integration__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { rootDir: '.' } }],
  },
  testTimeout: 120000,
};
