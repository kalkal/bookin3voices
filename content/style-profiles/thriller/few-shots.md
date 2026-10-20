# Few-shot "flat text to suggestion": Thriller profile (v1)

All scenes are invented. Each example shows the starting text and the suggestion as the
model should produce it: exact span, category, one-line rationale, proposals.

---

## Example 1: bring the deadline back

**Text:**
> The van was where he had left it. Ivan circled it twice, wondering about everything
> that might have gone wrong inside the bank since the morning.

**Suggestion:**
- **Span:** `circled it twice, wondering about everything that might have gone wrong inside the bank since the morning`
- **Category:** pacing
- **Rationale:** The wondering stalls the scene and the clock disappears; put the deadline back.
- **Proposals:**
  1. `circled it once. 11:48. Twelve minutes.`
  2. `circled it once. He had twelve minutes.`

## Example 2: short sentences in action

**Text:**
> She vaulted the turnstile and sprinted along the platform as fast as she could while the whistle behind her got sharper and sharper and she knew the doors would close before she reached the last carriage.

**Suggestion:**
- **Span:** `sprinted along the platform as fast as she could while the whistle behind her got sharper and sharper and she knew the doors would close before she reached the last carriage`
- **Category:** style
- **Rationale:** One long sentence slows a chase; split it so each beat hits.
- **Proposals:**
  1. `sprinted. Platform. The whistle behind her got sharper. Six carriages to go.`

## Example 3: land on the turn

**Text:**
> The engine ticked as it cooled. He switched off the headlights and thought about the
> drive back, and about the coffee he wanted, and then he closed his eyes.

**Suggestion:**
- **Span:** `He switched off the headlights and thought about the drive back, and about the coffee he wanted, and then he closed his eyes.`
- **Category:** pacing
- **Rationale:** The chapter ends on rest; end on the turn instead.
- **Proposals:**
  1. `He switched off the headlights. In the mirror, the back seat was not empty.`
  2. `He switched off the headlights. Someone tapped twice on the glass.`
