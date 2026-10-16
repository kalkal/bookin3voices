# Golden set: test passages for the "Suspense / Horror" profile

Six **fictional** passages (written on purpose, no real text from the book or from
existing works), in Italian, with **simulated dictation**: long sentences, sparse
punctuation, a few openings without a capital letter. Different genres and tones, because
the profile must hold up across registers without flattening them.

| File | Tone | What it mainly tests |
|---|---|---|
| `01-la-caldaia.md` | domestic tension | adverbs, filter verbs, stated emotion, refrain NOT to touch |
| `02-la-cucina-di-mamma.md` | dialogue | tags → "said", colloquial speech NOT to correct |
| `03-il-pozzo.md` | memoir, rich voice | targeted −10%, anaphora NOT to touch, low density |
| `04-il-parcheggio.md` | action | filters, passive, dictation punctuation, "breathless" long sentence NOT to break up |
| `05-la-cassa-tre.md` | everyday life cracking | show vs tell, concreteness without inventing facts |
| `06-le-magnolie.md` | everyday uncanny, long passage | density at the cap, refrain ×4, deliberate close repetition, run-on paragraph |

## How to use

- **Automatic runner (from the refineChapter callable)**: `npm run golden` in `functions/`
  runs ALL the passages against the current prompt (Style Bible + few-shots + the format
  rules in `refinePrompt.ts`) and mechanically checks density, the "MUST NOT" zones (from
  `checks.json`, which must stay aligned with the passages: the runner fails loudly if
  they diverge), grammar hierarchy and format; coverage of the "MUST" items is reported
  as a diagnostic. Key from env `GEMINI_API_KEY`, ONLY fictional passages on the free
  tier. Options: `-- --model X --fallback Y --only 04 --out report.md --dry`.
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
