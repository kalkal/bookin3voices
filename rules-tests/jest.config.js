/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', {}] },
  testMatch: ['**/*.test.ts'],
  // Le chiamate all'emulatore possono essere lente al primo giro (carico rules).
  testTimeout: 20000,
};
