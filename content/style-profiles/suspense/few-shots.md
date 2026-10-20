# Few-shot "flat text to suggestion": Suspense / Horror profile (v2)

All scenes are invented (no text comes from existing works). Each example shows the
starting text and the suggestion as the model should produce it: exact span, category,
one-line rationale, proposals (1 for `grammar`, up to 3 for `style`/`pacing`, most
conservative first). Example 11 covers non-intervention on a close repetition.

---

## Example 1: adverb in a dialogue tag

**Text:**
> Irene yanked the radio's plug out of the wall and held it up by the cable. "Not one
> more word about the quarry," she said furiously.

**Suggestion:**
- **Span:** `she said furiously`
- **Category:** style
- **Rationale:** The fury is already in the yanked plug and the line; the adverb explains it twice.
- **Proposals:**
  1. `she said`
  2. `she said, and wound the cable around her fist`

## Example 2: fancy tag

**Text:**
> "You sold the boat?" thundered Paolo indignantly, shoving his chair back so hard it hit the wall.

**Suggestion:**
- **Span:** `thundered Paolo indignantly`
- **Category:** style
- **Rationale:** The chair hitting the wall already says it all; the tag can disappear into "said".
- **Proposals:**
  1. `said Paolo`

## Example 3: show, don't tell

**Text:**
> When the lift jolted to a stop between two floors and the ceiling light went out,
> Greta was frightened. She pressed the alarm button twice.

**Suggestion:**
- **Span:** `Greta was frightened`
- **Category:** style
- **Rationale:** Named fear weighs less than shown fear; the stuck lift holds up on its own.
- **Proposals:**
  1. `Greta's breath went short`
  2. `Greta pressed her back against the mirror`
  3. `Greta listened to the cables creak above her`

## Example 4: rhythm in tension

**Text:**
> The dog stopped growling and she crouched behind the shop counter while she tried to
> remember whether she had bolted the back door and meanwhile something began to scrape
> slowly along the metal shutter outside.

**Suggestion:**
- **Span:** `The dog stopped growling and she crouched behind the shop counter while she tried to remember whether she had bolted the back door and meanwhile something began to scrape slowly along the metal shutter outside.`
- **Category:** pacing
- **Rationale:** At the moment of maximum tension the long sentence loosens the grip; splitting it speeds things up.
- **Proposals:**
  1. `The dog stopped growling and she crouched behind the shop counter, and could not remember whether she had bolted the back door. Something began to scrape, slowly, along the metal shutter outside.`
  2. `The dog stopped growling. She crouched behind the counter. Had she bolted the back door? Something began to scrape along the shutter.`

## Example 5: the concrete everyday (and when the right proposal is to cut)

**Text:**
> The vet's waiting room was as quiet as on any Sunday and yet there was an odd tension
> in the room, an unease she could not put into words. The empty cages, the water bowl,
> the calendar still on August.

**Suggestion:**
- **Span:** `and yet there was an odd tension in the room, an unease she could not put into words`
- **Category:** style
- **Rationale:** The objects listed afterwards already carry the unease; the abstract sentence waters it down. Which detail should "jar" is only the writer's call: here we only propose leaving the field to the objects.
- **Proposals:**
  1. `and yet there was an odd tension in the room` *(only the explanation of the feeling is cut)*
  2. *(cut the whole aside: the sentence becomes "The vet's waiting room was as quiet as on any Sunday. The empty cages, the water bowl, the calendar still on August.")*

## Example 6: filter verb

**Text:**
> Fabio realized that the garage light was on and that the car's bonnet was still warm.

**Suggestion:**
- **Span:** `Fabio realized that the garage light was on and that the car's bonnet was still warm.`
- **Category:** style
- **Rationale:** We are already inside Fabio's eyes; the filter "realized that" pushes us away.
- **Proposals:**
  1. `The garage light was on, the car's bonnet was still warm.`

## Example 7: minus 10% (several small cuts, one suggestion per span)

**Text:**
> She shrugged her shoulders and went down below to the jetty, where she saw with her own
> eyes that the rowing boat was gone.

**Suggestions (three, separate):**
1. **Span:** `shrugged her shoulders` — **Category:** pacing —
   **Rationale:** You can only shrug with your shoulders. —
   **Proposal:** `shrugged`
2. **Span:** `went down below` — **Category:** pacing — **Rationale:** "Down" already
   contains the below. — **Proposal:** `went down`
3. **Span:** `saw with her own eyes` — **Category:** pacing — **Rationale:** Whose eyes
   would she see with? The phrase adds nothing to "saw". — **Proposal:** `saw`

## Example 8: active voice

**Text:**
> The parcel was unwrapped by the neighbour before Bruno could stop her.

**Suggestion:**
- **Span:** `The parcel was unwrapped by the neighbour`
- **Category:** style
- **Rationale:** The agent is there and she is the one acting: the active restores the gesture.
- **Proposals:**
  1. `The neighbour unwrapped the parcel`

## Example 9: dictation punctuation (a single proposal)

**Text:**
> the train stopped in the tunnel the lights went out and nobody moved a child started
> knocking on the window from outside

**Suggestion:**
- **Span:** `the train stopped in the tunnel the lights went out and nobody moved a child started knocking on the window from outside`
- **Category:** grammar
- **Rationale:** Punctuation missing from the dictation; minimal correction, the words stay the ones dictated.
- **Proposal (just one):**
  1. `The train stopped in the tunnel. The lights went out, and nobody moved. A child started knocking on the window from outside.`

## Example 10: when NOT to intervene

**Text:**
> The ferryman never counted the passengers. He never counted the coins either: he said
> the river did that for him.

**Expected suggestion: none.**
The repetition of "never counted" is deliberate rhythm, the sentences are dry, the voice
works. On a text like this, silence is the right answer.

## Example 11: when NOT to intervene: close repetition inside one sentence

**Text:**
> He sat on the bottom step while the kettle heated, and meanwhile the wind made in the
> chimney the noise that wind makes in empty chimneys, the noise of a house that has been
> left.

**Expected suggestion: none.**
"The wind made … the noise that wind makes" repeats the same word twice within a breath
of each other, *inside the same sentence*: it is not a −10% redundancy, it is a refrain
in miniature: the sentence turns on itself on purpose, as the noise does. Closeness of
occurrences does not make a repetition an error. Proposing "the noise of wind in empty
chimneys" here would be a defect: it tidies the sentence and strips its voice.

---

## Example 12 (genre voice): show the unease before the thing

**Text:**
> The bathtub was full. Elena had not run it. She felt afraid, because the water was still warm.

**Suggestion:**
- **Span:** `She felt afraid, because`
- **Category:** style
- **Rationale:** Naming the fear explains it; let the warmth of the water carry it.
- **Proposals:**
  1. `Her fingers stopped above the surface.`
  2. `She stepped back onto the cold tiles.`
