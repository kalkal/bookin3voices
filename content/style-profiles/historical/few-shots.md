# Few-shot "flat text to suggestion": Historical fiction profile (v1)

All scenes are invented. Each example shows the starting text and the suggestion as the
model should produce it: exact span, category, one-line rationale, proposals.

---

## Example 1: a modern idiom in the period voice

**Text:**
> The harvest had failed for the second year. Livia folded the tax notice into her
> apron and told her brother it was no big deal, they would figure it out.

**Suggestion:**
- **Span:** `it was no big deal, they would figure it out`
- **Category:** style
- **Rationale:** A present-day phrase breaks the era; the same calm can be said in words of the time.
- **Proposals:**
  1. `it was of no matter, they would find a way`
  2. `it was nothing to fear, they would see it through`

## Example 2: the history lesson inside the scene

**Text:**
> The soldiers were at the bridge. The treaty signed two years earlier had given the
> valley to the duchy, which taxed salt heavily and had banned the old market fairs.
> Bruno pulled the mule off the road.

**Suggestion:**
- **Span:** `The treaty signed two years earlier had given the valley to the duchy, which taxed salt heavily and had banned the old market fairs.`
- **Category:** pacing
- **Rationale:** The lesson stops the scene at the bridge; say it as what the valley lives with, in fewer words.
- **Proposals:**
  1. `Since the treaty the valley paid the duchy's salt tax, and the old market fairs were banned.`

## Example 3: hindsight the period did not have

**Text:**
> The new railway reached the town in spring. The innkeeper, like everyone, could not
> yet know that it would empty the coaching inns within ten years.

**Suggestion:**
- **Span:** `like everyone, could not yet know that it would empty the coaching inns within ten years`
- **Category:** style
- **Rationale:** The narrator speaks from the future; let the innkeeper's present carry the worry.
- **Proposals:**
  1. `like everyone, feared that it would empty the coaching inns`
  2. `like everyone, wondered whether it would empty the coaching inns`

---

## Example 4 (genre voice): the era in one concrete detail

**Text:**
> The letter had to leave with the morning coach. The inkwell was dry. She felt the
> weight of the whole war on her shoulders as she looked for something to write with.

**Suggestion:**
- **Span:** `She felt the weight of the whole war on her shoulders as she looked for something to write with.`
- **Category:** style
- **Rationale:** The war named in general weighs less than the choice it forces on her now; let it press on what she does with the dry inkwell.
- **Proposals:**
  1. `With the war there was no ink to be had before the coach left, so she looked for something else to write with.`
  2. `The war had left her no ink and no time; she looked for something to write with before the coach.`
