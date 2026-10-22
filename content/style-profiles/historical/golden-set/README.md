# Golden set: test passages for the "Historical fiction" (Storico) profile

Two **fictional** passages written on purpose (no real text from a book or from existing
works, no real people), one in Italian and one in English, with **simulated dictation**.
Both name a period, so the History check is expected on them too.

| File | Tone | What it mainly tests |
|---|---|---|
| `01-la-filanda.md` | a silk mill, 1898 | modern idiom, history lesson inside the scene, hindsight, dialect and refrain NOT to touch |
| `02-the-toll-house.md` | a turnpike gate, 1824 | a later word («Okay») inside the dialogue, history lesson, dialogue punctuation, refrain NOT to touch |

## How to use

- Offline, no model call: `npm run golden:offline -- --profile historical` in `functions/`
  (also run by `goldenSetOffline.test.ts`). It replays the hand-written answers in
  `recorded/` through the provider factory with a fake client. Each recording folds the
  History check's period detail and anachronism into the same reply, and holds one
  proposal that deletes the author's words: the proposal guard must drop it.
- Alignment only: `npm run golden -- --profile historical --dry`.
- Live run against the configured model: `npm run golden -- --profile historical`
  (fictional passages only; ask before spending a real run).

Same maintenance rules as `suspense/golden-set/README.md`: rerun on every change to the
Style Bible, the few-shots, the prompt or the model, and keep `checks.json` aligned.
