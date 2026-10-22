# The judges' demo

The contest judges install an APK that talks to a **separate, empty Firebase project**, new
for the demo (never a project that held real books), on the same billing account.
Each phone signs in anonymously on its own and sees only its own data. **Without the
access code nothing reaches the server**: the app shows only the bundled sample book,
offline on the phone, with pre-recorded example suggestions. With the code from the
Devpost testing instructions the phone gets the `judge` claim, its own space in
Firestore (with a copy of the sample book) and the AI features, within hard caps.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Gate switch | `DEMO_GATE=1` in `functions/.env.<demo project id>` | Only the demo deployment has a gate; the emulators and any other project never do. |
| Live settings | Firestore `config/demo` (server only) | Kill switch, code hash, end date, caps, text limit. Read on every gated call: a change applies to the next call, with no redeploy. |
| Access code | callable `redeemAccessCode({ code })` | Compares the normalized code with `config/demo.codeSha256` in constant time; marks the phone in `demoAccess/{uid}` (server only) and puts the custom claim `judge: true` on its account. 10 attempts per phone per day; 30 WRONG codes per network address (hashed, IPv6 by /64) per day; no overall cap that could lock real judges out: every 50 wrong codes in a day log `access-code-guessing-alarm`. A right code is never stopped by the address or by other phones. |
| Rules | `firestore.demo.rules` (generated from `firestore.rules` by `scripts/build-demo-rules.mjs`), `storage.demo.rules` | The same per-user rules, where the owner must also carry the `judge` claim and `config/demo` must be enabled and not expired. Deployed with `firebase deploy --config firebase.demo.json`, so the emulators keep the normal rules. |
| Gated calls | every callable: `refineChapter`, `generateOutline`, `refineTitle`, `exportBook`, `exportBackup` (only `ping` and `redeemAccessCode` itself are open; `everyCallableGated.test.ts` fails if a new callable skips the gate) | Before any work: demo open, the `judge` claim on the token and the current code on record for this phone. Refine and outline then apply the demo caps and the text limit; the user's AI provider setting is ignored: Nova only. |
| Caps | `usage/rateLimit.ts` | Per phone per day, overall per day, and a total over the whole demo (`usageTotal/{action}`), in one transaction, before the model call. |
| Instances | `setGlobalOptions({ maxInstances: 3 })` in the demo | Abuse cannot multiply the Google Cloud side of the bill. |

Errors carry a `details.reason` the app turns into a clear message:
`access-code-required`, `wrong-code`, `too-many-attempts`, `demo-closed`,
`limit-reached` (with `scope`: `user`, `global` or `total`, and `resetsAt` for the daily
ones, midnight UTC) and `text-too-long` (with `maxChars`). When the AI is not available
the sample book shows pre-recorded example suggestions, always labelled as such.

The claim alone lasts until the phone's token expires (up to an hour); the server marker
`demoAccess/{uid}` and `config/demo`, read on every call, are what make a switch-off or
a code change immediate for the functions. In the rules, `enabled: false` is immediate
too.

Fail-closed: a missing or half-filled `config/demo`, `enabled: false` or a date past
`expiresAt` close the demo; a corrupted usage counter blocks instead of resetting.

## `config/demo`

Create it in the Firebase console (Firestore, collection `config`, document `demo`):

```json
{
  "enabled": true,
  "codeSha256": "<from npm run demo:hash>",
  "expiresAt": 1795219200000,
  "maxTextChars": 30000,
  "limits": {
    "refineChapter": { "perUserPerDay": 15, "globalPerDay": 40, "total": 200 },
    "generateOutline": { "perUserPerDay": 2, "globalPerDay": 5, "total": 30 },
    "refineTitle": { "perUserPerDay": 10, "globalPerDay": 30, "total": 100 }
  }
}
```

- `expiresAt` 1795219200000 = 21 Nov 2026 00:00 UTC, the day after judging ends.
- The hash: from `functions/`, `npm run demo:hash`, then type the code (read from
  standard input, never printed back). Case, spaces and
  `- _ .` separators do not matter («Tide-Lamp 4417» = «tide lamp 4417»). Only the hash
  is stored; the code lives in the Devpost testing instructions.
- All numbers are integers; every field is required.

## Switching it off

From the lightest to the strongest, each one immediate on the next call:

1. **No new phones**: change the code (a new `codeSha256`). Phones that entered the old
   code are asked for the new one.
2. **No more AI for anyone**: `enabled: false`. Both the code and the gated calls answer
   `demo-closed`; the app shows the example suggestions on the sample book.
3. **Fewer calls**: lower any cap; a cap at `0` stops that call for everyone.
4. **Hard stop on the AWS side**: deactivate the demo's dedicated AWS access key (IAM →
   user → Security credentials → Make inactive). Nova calls then fail at once.
5. **After judging**: deactivate the AWS key, then delete the Firebase project.

There is no Lambda in front of Nova (the functions call Bedrock directly), so the
"reserved concurrency 0" switch does not apply; the switches above take its place.

## Maximum spend

Worst case per call, from the limits in the code: the text sent is capped at 30,000
characters (about 8,500 tokens) plus about 6,000 tokens of instructions and style
profile; the answer at 8,192 tokens; a refine makes up to 2 attempts plus 2 short
history calls (no fallback model in the demo); an outline up to 2 attempts on a synopsis
of at most 20,000 characters; a title up to 2 attempts on the title plus a 4,000-character
excerpt.

| Call | Worst case tokens | Nova Lite | Nova Pro |
|---|---|---|---|
| Refine | ~49,000 in, ~20,400 out | ~$0.008 | ~$0.104 |
| Outline | ~16,000 in, ~16,400 out | ~$0.005 | ~$0.065 |
| Title | ~5,000 in, ~16,400 out | ~$0.004 | ~$0.056 |
| **Whole demo** (200 refines + 30 outlines + 100 titles, the total caps) | | **~$2.1** | **~$28.4** |
| Worst day (40 refines + 5 outlines + 30 titles, the daily caps) | | ~$0.5 | ~$6.2 |

The demo runs on **Nova Pro** (`BEDROCK_MODEL_ID=amazon.nova-pro-v1:0`): worst case about
$28.4 for the whole demo and $6.2 on the worst day, inside the AWS budget. Nova Lite is
the cheaper fallback if the budget ever needs it (one line in the env file and a redeploy).

Prices used, per million tokens, input / output: Nova Lite $0.06 / $0.24, Nova Pro
$0.80 / $3.20 (us-east-1, to be checked on the AWS pricing page before deploying).
Real calls are far below the worst case. Google Cloud: Firestore reads and writes and
function invocations of a few hundred calls stay inside the free quota of the Blaze plan.
On top of the caps, the AWS budget with a blocking action is the last safety net (it
lags hours behind, so it is not the brake).

## Security

- **Prompt injection.** The chapter text goes to the model as data inside the prompt.
  The model has no tools and no access to other data, and what it returns is never
  executed: only proposals, parsed against the schema and then checked against the text
  (`normalizeSuggestions`, `proposalGuard`). A proposal that deletes text, replaces a
  sentence with something unrelated or points at text that is not there is dropped. The
  golden set has two passages with hostile instructions inside the story (`14-il-biglietto`,
  `15-the-note`), and their recorded answers simulate a model that obeyed them: the
  offline golden test checks that every obeying proposal is dropped and the real edits
  survive.
- **Structured input** (the access code, ids, enums) accepts only an allowlist of
  characters and a length, checked first on the server (and the same in the app): the
  code is `^[A-Za-z0-9 -]{8,32}$` and the request object may hold nothing else. SQL,
  scripts, paths, templates, nested JSON or emoji are refused with `invalid-code-format`
  before the database is touched; the code is never echoed in an error, never logged (not
  even in part) and only ever hashed. `functions/src/security/__tests__/hostileInput.test.ts`
  feeds a list of hostile inputs to every structured field.
- **Free text** (chapters, synopsis) cannot forbid words: a novel may contain «SELECT». It
  is always data: never executed, never put into a query or a path. A detector
  (`functions/src/security/suspiciousInput.ts`) flags sql-like, script-tag,
  path-traversal, template-injection and prompt-injection-marker patterns in the
  structured log (`input-suspicious`, with the field and the kinds, never the text), for
  monitoring.
- **Input.** Every callable validates its input with Zod: lengths (text, synopsis, code),
  types, enums. Ids that end up in Firestore paths (`bookId`, `chapterId`, `requestId`)
  must be one safe path segment (`[A-Za-z0-9_-]{1,128}`, `functions/src/docId.ts`), so no
  caller can add segments to a path. The demo's own documents (`config/demo`,
  `demoAccess/{uid}`, the usage counters) are written only by the server.
- **Secrets.** No key is in the prompt, in the app or in the repo: AWS keys are function
  secrets. Error messages sent to the app are generic; the provider's own message (which
  may name the AWS account) stays in the server log.

## To check on the deployed function

- **The network address.** The per-address key uses the rightmost `X-Forwarded-For` entry
  (the one Google's front end appends; the leftmost, `rawRequest.ip`, is client-written).
  After the deploy: one wrong code from mobile data and one from home Wi-Fi must give two
  different `ipKey` values in the log (`access-code-wrong`). If they are the same, the
  key is the front end's address: the per-address cap then only slows wrong codes for
  everyone together, and a right code still always passes.

## Build and deploy

- **Functions**: `functions/.env.judges.example` → `functions/.env.<demo project id>`.
  Secrets: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of a dedicated IAM user that
  may only `bedrock:InvokeModel` the chosen Nova model in us-east-1, plus a placeholder
  `GEMINI_API_KEY` (the AI functions declare it; in the demo it is never used).
- **Rules**: `firestore.demo.rules` and `storage.demo.rules` (Storage fully closed: the
  app stores no files), deployed with `--config firebase.demo.json`; `config`,
  `demoAccess`, `usageDaily` and `usageTotal` are not in them, so clients can neither
  read nor write them.
- **App**: the EAS profile `judges` (package `dev.kalkal.bookvoice.demo`, so it installs
  next to the development build; access-code prompt and sample book on; test log off).
  The demo project's `EXPO_PUBLIC_FIREBASE_*` values are EAS environment variables, not
  in the repo.
- **App Check** is ready but OFF: `ENFORCE_APP_CHECK=1` in `functions/.env.<demo project id>` sets `enforceAppCheck` on every callable (Firestore enforcement is a console switch). It stays off because the app runs the Firebase JS SDK, which on Android has
  no Play Integrity provider (that needs the native `@react-native-firebase/app-check`).
  If it is ever turned on, the Play Integrity `PLAY_RECOGNIZED` requirement must be set to
  "Not required", because the APK is installed outside the Play Store.
- **Distribution**: the APK as an asset of a GitHub Release of the public repository,
  linked from the Devpost testing instructions.

## Devpost testing instructions (template)

> **Android app (APK).** Download: <GitHub Release link>. On the phone, allow your
> browser to install unknown apps when asked; Play Protect may ask for a scan, choose
> "Install anyway". The app opens in sample mode on a sample book, «Cristallo», which you
> can read and dictate into right away.
>
> **Access code: <CODE>.** Tap "Enter code" on the banner: you get your own space, your
> own copy of the sample book, new books and the AI features (Refine, Generate outline,
> powered by Amazon Nova). Each phone can refine up to 15 times and
> generate up to 2 outlines a day; the counters reset at midnight UTC. If a daily or the
> overall limit of the demo is reached, the sample book shows pre-recorded example
> suggestions, clearly labelled "Example", so you can still see how reviewing works.
>
> Your data stays on your own anonymous account; nobody else sees it. Dictation uses the
> phone's speech recognition (best with the Italian or English language pack installed).
