# Local development with the Firebase Emulator Suite

All development runs against the **Emulator Suite**, never against a real Firebase
project: `demo-bookvoice` is a demo project. The emulators are fully local; the project
id in `.firebaserc` is only a consistent label.

## Start the emulators

From `app/`:

```
npm run emulators
```

This runs `powershell -File scripts/start-emulators.ps1` from the repository root. The
script can put a portable Node 24 and JRE 21 on the PATH (optional `BOOKVOICE_TOOLS`
variable) and applies a Java workaround for AF_UNIX sockets that are blocked on some
Windows machines; the script comments explain the details. On Linux or macOS, run
`firebase emulators:start` from the repository root.

One-time prerequisite: `npm install` in `functions/`, and
`cp functions/.env.example functions/.env`. The first functions build starts on its own
with the emulators.

### Ports

| Emulator  | Port |
| --------- | ---- |
| Auth      | 9099 |
| Firestore | 8080 |
| Functions | 5001 |
| Storage   | 9199 |
| UI        | 4000 (http://127.0.0.1:4000) |

## AI credentials (`functions/.secret.local`)

The functions read their keys as secrets (`defineSecret`). Locally the Emulator Suite
loads them from `functions/.secret.local` (**ignored by git**); in production they come
from Secret Manager.

The default AI provider is Amazon Nova on Amazon Bedrock (see the "AI provider" section of
the `README.md`): put `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in
`functions/.secret.local`, or start the emulators with an AWS profile (`AWS_PROFILE`).

To use Gemini instead, set `AI_PROVIDER=gemini` in `functions/.env` and add one line to
`functions/.secret.local`:

```text
GEMINI_API_KEY=<your key>
```

Use your own key from Google AI Studio. Keys never go in the repository, in logs or in
output. If you use the free tier, send only invented sample text: Google may use free-tier
prompts for training.

## End-to-end smoke test

With the emulators running, from `app/`:

```
npm run emulators:smoke
```

It checks sign-up and sign-in on the Auth emulator and the `ping` callable on Functions.
With `GEMINI_SMOKE=1` it also calls the `geminiSmoke` callable, which sends one invented
sentence to Gemini and reports only the outcome and the model.

## Connecting the app to the emulators

`app/src/lib/firebase.ts` initialises the SDK and, in `__DEV__`, connects to the emulators
(host override: `EXPO_PUBLIC_EMULATOR_HOST`, for example `10.0.2.2` on the Android
emulator, or the computer's LAN IP on a physical device).

## Firestore security rules tests

The rules in `firestore.rules` (only the authenticated owner on `users/{uid}/**`, deny by
default, `schemaVersion` required on books and chapters) are covered by `rules-tests/`
with `@firebase/rules-unit-testing`. From the repository root:

```
firebase emulators:exec --only firestore --project demo-bookvoice "npm --prefix rules-tests run test:jest"
```

On Windows, `cd rules-tests && npm test` does the same through `scripts/test-rules.ps1`,
with the same Java workaround as the emulators. Note: the rules use an explicit match per
collection, not the recursive wildcard, so a new collection in the schema must also be
added to the rules (fail-closed) and to the test suite.
