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

What the dictation save indicator means (`DictationScreen` + `OfflineFirstChapterRepository`):

- «Salvato»: the text is on the phone (AsyncStorage mirror, durable) **and** handed to
  Firestore. Firestore confirms the write in the background (`commitInBackground`); a later
  server rejection is logged and the mirror pushes the text again on the next load.
- «Salvato sul telefono, sincronizzo appena possibile»: the phone is offline or Firestore
  refused the write; the text is safe in the mirror and goes up on the next save or load.
- Nothing is shown before the first save of the session.

## Test log (dev builds only)

Dev builds (`__DEV__`, or `EXPO_PUBLIC_TEST_LOG=1`, set by the `development` and `preview`
profiles in `eas.json`) write the manual test session as JSON Lines
(`src/features/testLog`). Store builds never set the flag and write nothing.

- File: `registro-prove/registro-YYYY-MM-DD.jsonl` (then `-2`, `-3`… past 2 MB), in the
  app's external files dir (local native module `modules/test-log-dir`, since
  expo-file-system cannot create that dir). Fetch it with no permission and no root:
  `adb pull /sdcard/Android/data/dev.kalkal.bookvoice/files/registro-prove/`
- If that dir cannot be created, the log falls back to the internal files dir; the
  `location` field of the header line says which one is in use.
- Settings › «Scarica registro» saves today's file through the share sheet.
- Every string is capped at 300 characters; text never leaves the phone by itself.
- Summary for a quick read: `npm run check:test-log -- registro-prove/` in `functions/`.
- Set `EXPO_PUBLIC_BUILD_SHA=$(git rev-parse --short HEAD)` when building, so the header
  names the commit.
- Refine calls send `debug: true`; the server answers with a `debugTrace` only where
  `DEBUG_TRACE=1` is set (a dev project) or in the emulator.

## Pre-commit (Husky + lint-staged)

`npm install` (the `prepare` script) sets `core.hooksPath = app/.husky/_` in the
repository's local config. The pre-commit hook runs lint-staged (ESLint + Prettier + Jest
on the changed files) and the full typecheck.
