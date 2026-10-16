# "Suspense / Horror" style profile

Material that defines the style of the AI refinements. All written with invented
examples and passages. It is loaded by the `refineChapter` Cloud Function
(`functions/src/ai/styleProfileContent.ts`).

| File | What it is |
|---|---|
| `style-bible.md` | Operating style rules, passed as the system instruction |
| `few-shots.md` | "Flat text → suggestion" pairs on invented scenes |
| `golden-set/` | Fictional test passages, each with its expected outcome (see its README) |

## Constraints

- No texts or extended quotations from existing works: only rules and invented passages
  live here, never passages from novels.
- Every change to Style Bible / few-shots / prompt / model → rerun the whole golden set
  (`npm run golden` in `functions/`). A style regression is a bug.
- Real passages from the book only on the paid Gemini tier; the fictional passages in
  this folder are fine on the free tier during development.
