# Few-shot "flat text to suggestion": Thriller profile (v1)

All scenes are invented. Each example shows the starting text and the suggestion as the
model should produce it: exact span, category, one-line rationale, proposals.

---

## Example 1: bring the deadline back

**Text:**
> The window was open. Elena walked slowly across the room, thinking about everything that
> could have happened while she was away.

**Suggestion:**
- **Span:** `walked slowly across the room, thinking about everything that could have happened while she was away`
- **Category:** pacing
- **Rationale:** The thinking stalls the scene and the clock disappears; put the deadline back.
- **Proposals:**
  1. `crossed the room. 3:12 a.m. Eight minutes.`
  2. `crossed the room. She had eight minutes.`

## Example 2: short sentences in action

**Text:**
> He grabbed the bag and ran down the stairs as fast as he could while the footsteps above him got louder and louder and he knew they would catch him before he reached the street.

**Suggestion:**
- **Span:** `ran down the stairs as fast as he could while the footsteps above him got louder and louder and he knew they would catch him before he reached the street`
- **Category:** style
- **Rationale:** One long sentence slows a chase; split it so each beat hits.
- **Proposals:**
  1. `ran. Stairs. The footsteps above got louder. Forty steps to the street.`

## Example 3: land on the turn

**Text:**
> The line went quiet. She put the phone down and thought about what he had said, and
> about how tired she was, and then she went to bed.

**Suggestion:**
- **Span:** `She put the phone down and thought about what he had said, and about how tired she was, and then she went to bed.`
- **Category:** pacing
- **Rationale:** The chapter ends on rest; end on the turn instead.
- **Proposals:**
  1. `She put the phone down. Behind her, the door handle moved.`
  2. `She put the phone down. The number on the screen was her own.`
