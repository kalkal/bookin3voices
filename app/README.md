# bookin3voice — mobile app

The Expo app (React Native + TypeScript) of bookin3voice. It lives in `app/`; the Cloud
Functions are in `functions/`, next to this folder.

## Commands

Requires Node 20+ (24 recommended) on your PATH.

| Command                    | What it does                           |
| -------------------------- | -------------------------------------- |
| `npm start`                | Starts Expo (dev server)               |
| `npm test`                 | Jest + jest-expo                       |
| `npm run typecheck`        | `tsc --noEmit` (strict)                |
| `npm run lint`             | ESLint (Expo flat config + Prettier)   |
| `npm run format`           | Prettier on the whole project          |
| `npm run test:integration` | Tests against the Firebase emulators   |
| `npm run emulators`        | Starts the Emulator Suite (Windows)    |
| `npm run e2e:android`      | Maestro flows (see `../e2e/README.md`) |

## Structure (feature folders)

```
app/
  App.tsx              UI entry point
  src/
    features/
      dictation/       dictation (engine, state machine, screens)
      review/          AI suggestions and review
      export/          EPUB/DOCX export and KDP preflight messages
    lib/               shared pure utilities (unit-tested)
  __tests__/           top-level component tests
```

Rules: components never touch the Firebase SDK (repository pattern), pure logic lives in
`src/lib` or in the features, tests sit next to the code in `__tests__/`.

- Failures are never silent: every error shows a plain message that says what to do next
  (microphone unavailable or not allowed, suggestions did not arrive – try again, save
  failed – your text is kept here).
- «Saved» appears only once the text is really stored in a safe place, never before.

## Pre-commit (Husky + lint-staged)

`npm install` (the `prepare` script) sets `core.hooksPath = app/.husky/_` in the
repository's local config. The pre-commit hook runs lint-staged (ESLint + Prettier + Jest
on the changed files) and the full typecheck.
