// ESLint flat config per le Cloud Functions: typescript-eslint
// + disattivazione dei conflitti di formattazione (la formattazione è di Prettier),
// stesso impianto di app/eslint.config.js.
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  tseslint.configs.recommended,
  prettierConfig,
  {
    // I file .js qui sono config CommonJS (questo file stesso): il require è voluto.
    files: ['**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    ignores: ['lib/*', 'node_modules/*'],
  },
]);
