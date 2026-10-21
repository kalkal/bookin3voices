# Golden set: test passages for the "Suspense / Horror" profile

Six **fictional** passages for the Style Bible, plus seven short ones for History (all written on purpose, no real text from the book or from
existing works), in Italian (08, 10 and 12 in English), with **simulated dictation**: long sentences, sparse
punctuation, a few openings without a capital letter. Different genres and tones, because
the profile must hold up across registers without flattening them.

| File | Tone | What it mainly tests |
|---|---|---|
| `01-la-macchia-sul-soffitto.md` | domestic tension (daytime) | adverbs, filter verbs, stated emotion, refrain NOT to touch |
| `02-il-deposito-all-alba.md` | dialogue between colleagues | tags → "said", colloquial speech NOT to correct |
| `03-l-accordo-di-santa-croce.md` | memoir, rich voice | targeted −10%, anaphora NOT to touch, low density |
| `04-la-passerella.md` | action | filters, passive, dictation punctuation, "breathless" long sentence NOT to break up |
| `05-la-partenza-in-salita.md` | everyday life cracking | show vs tell, concreteness without inventing facts |
| `06-la-cuffia-rossa.md` | everyday uncanny, long passage | density at the cap, refrain ×4, deliberate close repetition, run-on paragraph |
| `07-il-rifugio.md` … `13-la-riunione.md` | short invented passages for the History check | 07–12 name a period (Napoli 1943, London 1888, Torino 1911, Ohio 1925, Roma 1960, Paris 1900) with one anachronism each; 13 is a present-day trap that uses «Medioevo» figuratively. `checks.json` marks `period` and `language`: History must appear only on period passages, with both a period detail and the anachronism, every rationale starting with «Da verificare:» / «To check:» |

## How to use

- **Automatic runner (from the refineChapter callable)**: `npm run golden` in `functions/`
  runs ALL the passages against the current prompt (Style Bible + few-shots + the format
  rules in `refinePrompt.ts`) and mechanically checks density, the "MUST NOT" zones (from
  `checks.json`, which must stay aligned with the passages: the runner fails loudly if
  they diverge), grammar hierarchy and format; coverage of the "MUST" items is reported
  as a diagnostic. The model comes from the same provider factory as the callables
  (`AI_PROVIDER`, default `bedrock` = Amazon Nova with the usual AWS credentials, for
  example `AWS_PROFILE`; `gemini` = key from env `GEMINI_API_KEY`), ONLY fictional
  passages. It loads `functions/.env` when present (variables already exported win) and
  prints the number of model calls at the end. Options:
  `-- --model X --fallback Y --only 04 --out report.md --dry`.
- **Offline run (no model call, safe for CI)**: `npm run golden:offline` in `functions/`
  (and the `goldenSetOffline` jest test) replays the hand-written answers in `recorded/`
  through the same provider factory with a fake Bedrock client, then runs the same checks.
  It covers the code side (normalization, proposal guard, density), not the prompt or the
  model: those still need the live run above. Each recording may list `mustDrop`
  originals, proposals that would delete or replace text, which must not survive.
- **Proposal guard** (`functions/src/ai/proposalGuard.ts`): a proposal must change its
  original, never replace it. Grammar is a small edit: at most max(1, 20%) of the
  original's words may be lost, and at most as many new words may appear; words that
  are still in the proposal do not count as lost (a doubled phrase from dictation can be
  fixed), and spoken punctuation left in the text («punto e virgola» → «;») is free.
  For every kind but history (the label is the model's choice), content words (4+
  letters) may not be dropped: at most half of them, rounded down (min 1). New words do
  not buy back lost ones, except one word swapped in a short clause (up to 4 content
  words, proposal 60%+ of its length, e.g. «ammise Bruno sconsolatamente» → «disse
  Bruno»). A rewrite that shows instead of telling keeps its anchor words. A short original (under 3 content words) may gain at most one
  new content word and two words overall. Style and pacing also keep at least one
  content word of the original, and 30% of them when the original has 12+ words.
  History hints are not judged. Tune the
  thresholds only with a golden run (live and offline).
- For a manual try (e.g. in Google AI Studio): paste the Style Bible and few-shots as the
  system instruction and, as the message, only the "Brano" (passage) section, never the
  "Esito atteso" (expected outcome).
- The "Esito atteso" is a **checklist for human judgement**, not an automatic test: it
  says what the model MUST flag, what it MAY flag and, above all, what it MUST NOT touch.
  The runner only blocks mechanical regressions: the final verdict is human.

## Maintenance rules (binding)

- **Rerun the whole set on every change** to Style Bible, few-shots, prompt or model
  (`npm run golden` in `functions/`). A style regression is a bug in every respect.
- When a passage is added or changed, update its entry in `checks.json` (verbatim
  quotations: the runner checks alignment, even with `--dry`).
- The passages are fictional: in development they may also be used on Gemini's free tier.
  The **real** passages of the book go ONLY through the paid tier.
- The set grows: when a real passage exposes a new defect, a fictional passage that
  reproduces that defect is added here, with its expected outcome.
