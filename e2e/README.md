# End-to-end tests with Maestro

End-to-end flows on the Android emulator with [Maestro](https://maestro.mobile.dev): YAML
files in `flows/`, using the testIDs defined by the screens.

## How E2E mode works

Real speech-to-text is not practical on the emulator, so the flows run with the app in
**E2E mode**: Metro started with `EXPO_PUBLIC_E2E=1` makes `App.tsx` use the
`FakeDictationEngine`, driven by a timed script, a pre-flight check that always passes and
in-memory services only (no Firebase, no AsyncStorage). See `app/src/dev/e2eDictation.ts`
and the E2E block in `app/App.tsx`, which seeds:

- an **empty** chapter for dictation (the flow checks exactly that path);
- a chapter already written for the review, with text that triggers two rules of the
  `FakeSuggestionsProvider`;
- two fixed pending suggestions for the warning in the Export tab; the export uses
  `InMemoryBookExportService` (a fake file, no Emulator Suite and no share sheet; the real
  EPUB is covered by the Export feature's Jest tests on the Firebase emulators).

Normal use of the app never goes through this path: without the variable the bundle uses
the native engine and the Firebase services. Every flow restarts from a fresh process
(`stopApp` in the shared preamble `helpers/open-e2e-app.yaml`), so in-memory state never
leaks from one flow to the next.

## Prerequisites (one time)

- **Android SDK + emulator** (any AVD, for example API 36 Google APIs x86_64).
- **Maestro CLI** (requires Java).
- **Dev client installed**: an EAS `development` build (APK), then `adb install <apk>`.
  Rebuild only when the native part changes.

The scripts look for the SDK and Maestro in a `tools` folder next to the repository (or in
the folder named by `BOOKVOICE_TOOLS`); for other locations (for example CI) set the
`ANDROID_SDK_ROOT` and `MAESTRO_BIN` environment variables.

## Run the flows

```powershell
# 1. start the Android emulator (window), for example:
emulator -avd <avd-name>

# 2. from the app/ folder:
npm run e2e:android
```

`run-android.mjs` checks the emulator and the dev client, runs `adb reverse tcp:8081`,
starts Metro with `EXPO_PUBLIC_E2E=1`, runs `maestro test` on **the whole `flows/` folder**
(in alphabetical order) and shuts everything down. One flow only:
`npm run e2e:android -- ..\e2e\flows\<name>.yaml`.

## Flows

| Flow | Path covered |
|---|---|
| `flows/dictation-fake.yaml` | open dictation → dictate (fake engine) → pause → text, word count and save |
| `flows/export-epub.yaml` | book → Export tab → "2 pending suggestions" warning → Generate EPUB → "generated" result |
| `flows/review-accept.yaml` | book → seeded chapter → refine with AI → accept variant B (style), reject the grammar one → updated text, no pending suggestions left |

The shared preamble (deep link, developer menu, `stopApp`) is in
`helpers/open-e2e-app.yaml`, called by the flows with `runFlow`.
