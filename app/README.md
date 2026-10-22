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

## Judges build (contest demo)

The `judges` profile in `eas.json` builds an internal APK for the contest judges, installable
next to the regular app:

- `APP_VARIANT=judges`: `app.config.ts` takes `app.json` as it is and only changes the Android
  package to `dev.kalkal.bookvoice.demo` and the name to «bookin3voice (demo)».
- `EXPO_PUBLIC_ACCESS_GATE=1` (`src/features/accessCode`): without the access code the app
  touches nothing on the server. After the anonymous sign-in the app reads the ID token claims:
  - no `judge: true` claim → **offline sample mode**: in-memory repositories with the bundled
    sample book, example suggestions for Refine, and a banner «Sample mode — enter the access code
    to use your own books and AI» with an «Enter code» button. Every other server action (outline,
    export, backup, refine with no example) opens the access code prompt;
  - the prompt sends the code to the `redeemAccessCode` callable (the server sets the claim),
    refreshes the ID token, switches to the Firestore repositories (every screen remounts) and
    creates the sample book there if it is missing;
  - claim already present → online directly; the live AI falls back to the example suggestions
    when it is unavailable (demo closed, limits reached).

  The code is never stored on the phone: the claim lives on the anonymous account.

- `EXPO_PUBLIC_SAMPLE_BOOK=1`: the bundled sample book (`src/features/sample`).
- No `EXPO_PUBLIC_TEST_LOG`: the judges' phones write no test log.

The Firebase web config of the judges project is **not** in the repository. Set the five
`EXPO_PUBLIC_FIREBASE_*` variables (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`,
`APP_ID`) as EAS environment variables of the environment the profile reads (`"environment":
"preview"` in `eas.json`), with plain-text or sensitive visibility. If the regular preview build
needs a different Firebase project, create a dedicated environment for the judges project and
point the profile's `environment` at it instead.

## Sample book (judges' build only)

`EXPO_PUBLIC_SAMPLE_BOOK=1` at build time turns it on; without it the app is unchanged.

- Content: `content/sample-book/` (`book.json` + one Markdown file per chapter) is the
  source of truth. After editing it run `node scripts/build-sample-book.js` (from `app/`) to
  regenerate `src/features/sample/sampleBookContent.ts`; a unit test fails if they drift.
- Without the access code the app touches nothing on the server:
  `createOfflineSampleRepositories()` returns in-memory book, chapter and note repositories
  pre-filled with book `sample` and chapters `sample-1..3`, plus a suggestions provider that
  serves only the pre-recorded examples. Dictation and editing work locally; nothing syncs,
  and a restart starts again from the bundled text.
- With the access code (`judge` claim on the ID token): `seedSampleBook({ bookRepository,
marker, uid })` creates the same book in the user's Firestore space, in one transaction
  that writes only when the book does not exist (racing calls never duplicate). A local
  marker then keeps a deleted sample book from coming back; a failure is logged and retried
  on the next call.
- Example mode: the pre-recorded suggestions stored with the content (`exampleRefineResult`)
  are served only on the sample book, offline (no claim) or, with the claim, when the live AI
  is unavailable (`ExampleFallbackSuggestionsProvider`; its `isAiUnavailable` parameter
  decides, a placeholder on callable codes for now). They are always labelled «Example —
  pre-recorded, not live AI» in the editor, the review screen and on each card.

## Pre-commit (Husky + lint-staged)

`npm install` (the `prepare` script) sets `core.hooksPath = app/.husky/_` in the
repository's local config. The pre-commit hook runs lint-staged (ESLint + Prettier + Jest
on the changed files) and the full typecheck.
