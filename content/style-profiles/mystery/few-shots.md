# Few-shot "flat text to suggestion": Mystery (whodunit) profile (v1)

All scenes are invented. Each example shows the starting text and the suggestion as the
model should produce it: exact span, category, one-line rationale, proposals.

---

## Example 1: camouflage a clue

**Text:**
> The clock in the study had stopped at ten past nine, although the cleaner swore she had
> wound it that morning, and Inspector Ferri bent close and examined it for a long time.

**Suggestion:**
- **Span:** `bent close and examined it for a long time`
- **Category:** pacing
- **Rationale:** The long look spotlights the clue; the reader should see it and not yet know it matters.
- **Proposals:**
  1. `added it to the list of things in the room`
  2. `asked the cleaner what time she left`

## Example 2: fair play

**Text:**
> Silvia Conti understood at once that the train ticket had been bought at the station
> kiosk, the one nobody had brought up so far.

**Suggestion:**
- **Span:** `the one nobody had brought up so far`
- **Category:** pacing
- **Rationale:** The decisive kiosk was never shown to the reader; plant it earlier or the solution feels unfair.
- **Proposals:**
  1. `the one beside the left-luggage office, where she had bought her own paper on the first morning`

## Example 3: reveal too early

**Text:**
> "The dog didn't bark when you came in," said Ferri. "It knew you. You're the one who
> left the gate open that night."

**Suggestion:**
- **Span:** `It knew you. You're the one who left the gate open that night`
- **Category:** pacing
- **Rationale:** The scene answers the central question two chapters early; keep it open.
- **Proposals:**
  1. `So who else did it know?`
  2. `Dogs bark at strangers. Who here isn't one?`
