# Few-shot "flat text to suggestion": Mystery (whodunit) profile (v1)

All scenes are invented. Each example shows the starting text and the suggestion as the
model should produce it: exact span, category, one-line rationale, proposals.

---

## Example 1: camouflage a clue

**Text:**
> The window was open. It had rained all night, yet the sill was perfectly dry, and
> Inspector Hale stopped dead and stared at it.

**Suggestion:**
- **Span:** `stopped dead and stared at it`
- **Category:** pacing
- **Rationale:** The stare spotlights the clue; the reader should see it and not yet know it matters.
- **Proposals:**
  1. `wrote the time in his notebook`
  2. `moved on to the stairs`

## Example 2: fair play

**Text:**
> Dr. Weiss knew at once that the poison had come from the greenhouse key, the one
> nobody had mentioned until now.

**Suggestion:**
- **Span:** `the one nobody had mentioned until now`
- **Category:** pacing
- **Rationale:** The decisive key was never shown to the reader; plant it earlier or the solution feels unfair.
- **Proposals:**
  1. `the one hanging by the kitchen door, as it had on the first night`

## Example 3: reveal too early

**Text:**
> "You were never at the harbour," said Hale. "You killed him, and the ledger proves it."

**Suggestion:**
- **Span:** `You killed him, and the ledger proves it`
- **Category:** pacing
- **Rationale:** The scene answers the central question two chapters early; keep it open.
- **Proposals:**
  1. `The ledger has a page missing. Who tore it out?`
  2. `You say the harbour. The ledger says otherwise.`
