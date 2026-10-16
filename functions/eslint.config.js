// ESLint flat config for the Cloud Functions: typescript-eslint
// + disabling of formatting conflicts (formatting belongs to Prettier),
// same setup as app/eslint.config.js.
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  tseslint.configs.recommended,
  prettierConfig,
  {
    // The .js files here are CommonJS configs (this file itself): require is intended.
    files: ['**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    ignores: ['lib/*', 'node_modules/*'],
  },
]);
