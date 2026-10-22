<p align="center"><a href="https://github.com/kalkal"><img src="docs/brand/kalkal-mark.svg" alt="kalkal" height="56"></a></p>

<p align="center"><a href="https://github.com/kalkal"><img src="docs/brand/kalkal-mark.svg" alt="kalkal" height="56"></a></p>

# bookin3voice

Dictate a book out loud, get precise style suggestions from an AI, and export files that are
ready for Amazon KDP (EPUB and DOCX).

bookin3voice is a mobile app (React Native / Expo) backed by Firebase. Suggestions and chapter
outlines come from **Amazon Nova on Amazon Bedrock**, the only AI provider. Licensed under the
[GNU AGPL v3.0 only](LICENSE), Copyright 2026 kalkal.

## Why it matters

Writing a book is mostly typing, and typing is what stops many people: a parent with a few spare
minutes on the commute, someone with a repetitive-strain injury, a person who thinks better
while walking. Speaking is faster and more natural, but raw dictation is messy. bookin3voice
closes the loop: you talk, it keeps the text safe (offline first, autosave, backups), an
editor-like AI points at the exact words worth changing and why, and a **KDP preflight check**
tells you what Amazon would reject before you upload.

## What it does

- **Dictation** per chapter in Italian or English, with live autosave and an offline-first
  store that syncs when the network comes back. Voice commands ("new paragraph", punctuation)
  appear as **tappable command chips**, so you can see and tap what the app understood, and
  saying **"ferma dettatura"** stops dictation, the same as a tap on the microphone.
- **Read and Dictate buttons** on every chapter row: listen to a chapter read back, or start
  dictating into it with one tap.
- **Refine** the whole chapter, only the **selected text**, a single **paragraph**, or the
  **title**. Suggestions are anchored to exact spans of your text and come in kinds: **style**,
  **grammar**, **pacing** and **period** (historical details and possible anachronisms, only
  when the text names a past time, always as hints to check). Each suggestion has a one-line
  reason and one to three proposals; you accept or reject each one. The AI never rewrites the
  chapter, and refine never hides your text or goes silent.
- **Three genres** per book: **Suspense / Horror**, **Mystery (whodunit)** and
  **Historical fiction** (*Storico*).
- **Outline generator**: from a synopsis to a chapter-by-chapter outline you confirm.
- **KDP preflight check** before export: title and author, description length, empty chapters,
  blank table-of-contents entries, minimum length, and cover size and format when cover
  details are supplied (the app has no cover upload yet, so it warns that the cover is
  missing). Errors and warnings with clear messages; the server can also block the export
  (`strict`).
- **Export** to EPUB (checked with EPUBCheck, the W3C conformance checker) and DOCX, plus a
  Markdown backup of the raw text.
- **Sample mode** with a sample book (invented text): reading, dictation, editing and the
  Refine review with pre-recorded "Example" suggestions work locally without writing anything;
  live AI, export, outline and backup run in normal mode (see "Try the sample book").
- Notes, daily word goals and streaks.
- English and Italian interface: the app follows the device language, or the language picked in
  Settings (`EXPO_PUBLIC_UI_LANG` forces one), and a new book is created in the interface
  language, which the AI uses.

## How it works

```
 Expo app (React Native, TypeScript)           Firebase (emulators locally)
 ┌──────────────────────────────┐   callable   ┌──────────────────────────────┐
 │ dictation · editor · review  │ ───────────▶ │ Cloud Functions (Node 20)    │
 │ offline-first repositories   │              │  refineChapter  generateOutline
 │ genre picker · export tab    │ ◀─────────── │  exportBook (KDP preflight)  │
 └──────────────┬───────────────┘   results    │  exportBackup                │
                │ Firestore SDK                └───────┬──────────────┬───────┘
                ▼                                      │ AiProvider   │ Firestore
        Firestore + Auth (per-user rules)              ▼ port         ▼
                                              Amazon Nova (Bedrock)  users/{uid}/…
```

- **Per-user data** lives under `users/{uid}/…`; security rules deny everything else and are
  covered by tests (`rules-tests/`).
- **One AI port.** `functions/src/ai/provider/` defines `AiProvider.generateJson(request)` that
  returns a value (`{ ok: true, value }` or `{ ok: false, error }`), never throws, and has a
  per-call timeout. Prompts, the JSON contract, validation (Zod) and the "exact span, found
  once" rule live outside the provider, so the model can change without touching them.
- **Safe suggestions.** The model must quote the exact words it wants to change; the server
  discards anything that is absent or ambiguous in the text, caps the density and drops
  overlaps, so a suggestion can never be applied blindly.
- **Idempotent callables** keyed by `requestId`: a network retry never duplicates work or
  spends the AI budget twice.

Repository layout: `app/` Expo app · `functions/` Cloud Functions (AI, export, backup) ·
`content/style-profiles/` the style instructions and invented examples · `rules-tests/`
security-rules tests · `e2e/` Maestro flows · [`docs/local-development.md`](docs/local-development.md) emulator setup.

## AI provider

**Amazon Nova Pro on Amazon Bedrock**, through the Converse API
(`@aws-sdk/client-bedrock-runtime`). Nova has no native JSON mode, so the answer is forced into
the JSON schema with a single tool and `toolChoice`; plain or fenced JSON text is also accepted.

| Variable | Meaning | Default |
| --- | --- | --- |
| `BEDROCK_MODEL_ID` | Bedrock model id or inference profile id | `amazon.nova-pro-v1:0` |
| `BEDROCK_MODEL_ID_OUTLINE` / `BEDROCK_MODEL_ID_FALLBACK` | optional outline model / fallback model | same as above / none |
| `BEDROCK_REGION` (or `AWS_REGION`) | AWS region | `us-east-1` |

The model id `amazon.nova-pro-v1:0` and its availability in `us-east-1` (in-region and through
the `us.amazon.nova-pro-v1:0` inference profile) are from the
[Amazon Bedrock model card for Nova Pro](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html);
the model supports the Converse API and client-side tool calling, and allows up to 10K output
tokens. Check the card for the lifecycle status before you deploy: models are retired over time,
and newer Nova models can be selected by changing `BEDROCK_MODEL_ID` only.

**Choosing a model.** Nova Pro follows each style more closely.
Nova Lite (`amazon.nova-lite-v1:0`,
[model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-lite.html))
is roughly 13 times cheaper per token and works too, with weaker suggestions; set
`BEDROCK_MODEL_ID` to use it. Current prices are on the
[Amazon Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/).

**Credentials.** Standard AWS credentials, never in the code or the repository: environment
variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), a profile (`AWS_PROFILE`, including
SSO), or an IAM role. For the emulator put them in `functions/.secret.local`; in production
use Secret Manager (`firebase functions:secrets:set AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`; deployment declares both, so create each one before you deploy).

**Minimum permission.** Create an IAM user (or role) that can only call the one model:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-pro-v1:0"
    }
  ]
}
```

If you use an inference profile id (`us.amazon.nova-pro-v1:0`) also allow the profile ARN
(`arn:aws:bedrock:us-east-1:<account-id>:inference-profile/us.amazon.nova-pro-v1:0`) and the
foundation model in the destination regions. Depending on the account you may also have to
enable access to the model in the Bedrock console.

Timeouts are 80 s per call and 140 s for the outline, three attempts at most. Errors are
classified (`throttled`, `timeout`, `blocked`, `truncated`, `invalid_json`, ...) and logged
without any prompt or text.

## Writing styles

Defined in one place: `functions/src/ai/styles.ts` (ids and labels in English and Italian);
the instructions and the invented example sentences of each style are in
`content/style-profiles/<id>/`. The choice is stored per book (`styleProfileId`); an unknown
or missing value falls back to Suspense / Horror; books saved with a retired style id open
as Historical fiction (`RETIRED_STYLE_IDS`, the stored value is not rewritten).
No style imitates a real author.

| Style | What the suggestions look for |
| --- | --- |
| Suspense / Horror | tension from a threat not yet seen, sensory detail, body before mind |
| Mystery (whodunit) | camouflaged clues, red herrings, fair play, reveals that come too early |
| Historical fiction (Storico) | period voice without modern idioms, history told through the scene not as a lesson, no hindsight; period facts are left to the History check |

To add a style: add a folder under `content/style-profiles/`, an entry in
`functions/src/ai/styles.ts` and in `app/src/features/books/styles.ts`; the tests check that
the new style has its own instructions and examples.

## Run it locally

Everything runs against the **Firebase Emulator Suite**, never a real project.

Prerequisites: Node 20+ (24 recommended), Java 21+ (for the emulators), `firebase-tools`
(`npm i -g firebase-tools`). On Windows the helper scripts are PowerShell; on macOS/Linux run
the commands inside them by hand.

```bash
# 1. install
(cd functions && npm ci) && (cd app && npm ci) && (cd rules-tests && npm ci)

# 2. configure the functions
cp functions/.env.example functions/.env          # then edit if needed
# put AWS credentials in functions/.secret.local, never in git

# 3. start the emulators (Auth, Firestore, Functions, Storage, UI on :4000)
npm --prefix functions run build && firebase emulators:start
#   Windows: cd app && npm run emulators

# 4. start the app (another terminal)
cd app && npx expo start
```

The project id in `.firebaserc` is `demo-bookvoice`: a `demo-` project never reaches the cloud.
To build the app against your own Firebase project, copy `app/.env.example` to `app/.env` and
fill in the `EXPO_PUBLIC_FIREBASE_*` values.

### Try the sample book

1. **A development build, no Expo account needed.** With the Android SDK installed and a phone
   (USB debugging on) or an Android emulator connected, build and install it locally:

   ```bash
   cd app && npx expo run:android
   ```

2. **Let the device reach the emulators** (Auth 9099, Firestore 8080, Functions 5001,
   Storage 9199) and Metro (8081):
   - Android emulator: set `EXPO_PUBLIC_EMULATOR_HOST=10.0.2.2` when you start Metro;
   - phone over USB: keep the default host and forward the ports,
     `adb reverse tcp:8081 tcp:8081`, and the same for 9099, 8080, 5001 and 9199;
   - phone over Wi-Fi: set `EXPO_PUBLIC_EMULATOR_HOST` to the PC's LAN IP.

3. With the emulators running (step 3 above), start Metro with both flags on, from `app/`:

```bash
EXPO_PUBLIC_ACCESS_GATE=1 EXPO_PUBLIC_SAMPLE_BOOK=1 npx expo start --dev-client --clear
```

PowerShell: `$env:EXPO_PUBLIC_ACCESS_GATE='1'; $env:EXPO_PUBLIC_SAMPLE_BOOK='1'; npx expo start --dev-client --clear`.
Both variables are needed (the sample book is wired into the access-mode flow); `--clear` matters,
or Metro can serve a cached bundle without them.

A banner at the top says "Sample mode — enter the access code to use your own books and AI": ignore
it. The access code only exists for a hosted demo, which is not offered in this contest, and is
never required to read or refine the sample book locally. The prompt only opens if you tap it, or
try something that needs the server (export, outline, backup, or Refine on text outside the sample).

You'll see the sample book "Cristallo" (3 chapters, English); Refine shows pre-recorded suggestions
labelled "Example — pre-recorded, not live AI"; reading, dictation and editing work locally, and
edits live in memory and are lost on restart. The app still signs in anonymously at startup (it
needs Firebase Auth reachable), so the emulators must be running; with them up, no data reaches
any server of ours and no account of ours is needed.

What needs **normal mode** (start Metro without the two flags): export (EPUB/DOCX with the KDP
preflight) and the Markdown backup work on the emulators without any AI or AWS account; live
Refine and Generate outline call Amazon Nova, so they need your own AWS credentials
(`bedrock:InvokeModel` on Nova in us-east-1, see "AI provider").

## Run the tests

```bash
# unit tests, no services needed
(cd functions && npm test)   # AI provider, styles, KDP preflight, exporters
(cd app && npm test)         # screens, repositories, state machines

# on the Firebase emulators (Java 21 + firebase-tools 14)
cp functions/.env.example functions/.env
(cd functions && npm run build)
firebase emulators:exec --only firestore --project demo-bookvoice "npm --prefix rules-tests run test:jest"
firebase emulators:exec --only firestore --project demo-bookvoice-functions "npm --prefix functions run test:integration"
firebase emulators:exec --only auth,firestore,functions --project demo-bookvoice-app "npm --prefix app run test:integration"
```

On Windows, `cd rules-tests && npm test` runs the rules suite through a PowerShell script.
The CI workflow runs the same commands.

The unit suites need no emulator, no network and no credentials. Integration tests use the
emulators; the EPUB checks use [EPUBCheck](https://github.com/w3c/epubcheck) (set `EPUBCHECK_JAR`
or place the jar in `tools/epubcheck/epubcheck.jar`). Tests that call a real model are skipped
unless credentials are present.

## What's next

- **Dictate your book hands-free with Alexa**: an Alexa skill that reads back the last chapter,
  tells you where you are in the book and saves short voice notes.

## Trademarks

Amazon, Alexa, Amazon Nova, Amazon Bedrock, AWS and Kindle Direct Publishing are trademarks of Amazon.com, Inc. or its affiliates. Google and Firebase are trademarks of Google LLC. Other names are trademarks of their respective owners. This is an independent hackathon project, not affiliated with or endorsed by Amazon or Google.

## License

[GNU AGPL v3.0 only](LICENSE), Copyright 2026 kalkal. Third-party code, fonts and data keep their own licenses (see [NOTICE](NOTICE) and `THIRD_PARTY_LICENSES.md`).
