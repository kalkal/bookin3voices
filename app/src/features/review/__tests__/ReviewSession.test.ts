import { ReviewSession } from '../ReviewSession';
import { textHash } from '../textHash';
import type { RefineResult, Suggestion, SuggestionKind } from '../types';

const TEXT = 'Posò lentamente il telefono. aprì la finestra e un altra tazza cadde.';

/** Builds a pending suggestion with the span computed from the fragment. */
function sug(
  id: string,
  kind: SuggestionKind,
  fragment: string,
  proposals: string[],
  overrides: Partial<Suggestion> = {},
): Suggestion {
  const from = TEXT.indexOf(fragment);
  if (from === -1) throw new Error(`fragment not found: ${fragment}`);
  return {
    id,
    kind,
    span: { from, to: from + fragment.length },
    original: fragment,
    proposals,
    rationale: 'motivazione di prova',
    state: 'pending',
    textHash: textHash(TEXT),
    ...overrides,
  };
}

const STYLE_ADVERB = () =>
  sug('s-avverbio', 'style', 'Posò lentamente', ['Posò', 'Posò, piano,', 'Posò senza fretta']);
const GRAMMAR_LOWER = () => sug('s-minuscola', 'grammar', 'aprì', ['Aprì']);
const GRAMMAR_ELISION = () => sug('s-elisione', 'grammar', 'un altra', ["un'altra"]);

function freshResult(suggestions: Suggestion[]): RefineResult {
  return { textHash: textHash(TEXT), suggestions };
}

function newSession(suggestions: Suggestion[] = []): ReviewSession {
  const session = new ReviewSession({ initialText: TEXT, now: () => 1000 });
  if (suggestions.length > 0) {
    session.ingest(freshResult(suggestions));
  }
  return session;
}

describe('ingest (text hash)', () => {
  it('with a matching hash the suggestions stay pending', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_LOWER()]);
    expect(session.pending).toHaveLength(2);
  });

  it('with a different hash (text changed during refinement) the batch is born stale', () => {
    const session = new ReviewSession({ initialText: TEXT });
    const outcome = session.ingest({ textHash: 'v1-altro', suggestions: [STYLE_ADVERB()] });
    expect(outcome.bornStale).toBe(true);
    expect(session.pending).toHaveLength(0);
    expect(session.suggestions[0].state).toBe('stale');
  });

  it('a suggestion whose original does not match the text is born stale (never blind trust)', () => {
    const bugged = { ...STYLE_ADVERB(), original: 'Posò lentissimo', id: 's-bug' };
    bugged.span = { from: 0, to: bugged.original.length };
    const session = new ReviewSession({ initialText: TEXT });
    session.ingest(freshResult([bugged, GRAMMAR_LOWER()]));
    expect(session.suggestions.find((s) => s.id === 's-bug')?.state).toBe('stale');
    expect(session.pending).toHaveLength(1);
  });
});

describe('accept (Command with verified patch)', () => {
  it('applies the chosen variant and records the revision', () => {
    const session = newSession([STYLE_ADVERB()]);
    const outcome = session.accept('s-avverbio', 1);
    if (!outcome.ok) throw new Error('accept failed');
    expect(outcome.text).toBe('Posò, piano, il telefono. aprì la finestra e un altra tazza cadde.');
    expect(outcome.revision).toMatchObject({
      before: 'Posò lentamente',
      after: 'Posò, piano,',
      decision: 'accepted',
      at: 1000,
    });
    const accepted = session.suggestions.find((s) => s.id === 's-avverbio');
    expect(accepted).toMatchObject({ state: 'accepted', acceptedProposal: 1 });
  });

  it('re-maps the spans of the following pendings', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_ELISION()]);
    const before = session.suggestions.find((s) => s.id === 's-elisione');
    if (!before) throw new Error('suggestion missing');
    session.accept('s-avverbio', 0); // 'Posò lentamente' → 'Posò': delta -11
    const after = session.suggestions.find((s) => s.id === 's-elisione');
    expect(after?.state).toBe('pending');
    expect(after?.span).toEqual({ from: before.span.from - 11, to: before.span.to - 11 });
    // the re-mapped span still points at the right text
    expect(session.text.slice(after!.span.from, after!.span.to)).toBe('un altra');
  });

  it('a pending overlapping the accepted patch becomes stale', () => {
    const overlapping = sug('s-sovrapposto', 'style', 'lentamente il', ['il']);
    const session = newSession([STYLE_ADVERB(), overlapping]);
    session.accept('s-avverbio', 0);
    expect(session.suggestions.find((s) => s.id === 's-sovrapposto')?.state).toBe('stale');
  });

  it('cleanly rejects accept on a non-pending or unknown suggestion', () => {
    const session = newSession([STYLE_ADVERB()]);
    session.accept('s-avverbio', 0);
    expect(session.accept('s-avverbio', 0)).toEqual({ ok: false, reason: 'not-pending' });
    expect(session.accept('fantasma')).toEqual({ ok: false, reason: 'unknown-suggestion' });
    expect(session.accept('s-avverbio', 9)).toEqual({ ok: false, reason: 'not-pending' });
  });

  it('proposal index out of range: clean rejection without touching the text', () => {
    const session = newSession([STYLE_ADVERB()]);
    expect(session.accept('s-avverbio', 3)).toEqual({ ok: false, reason: 'invalid-proposal' });
    expect(session.text).toBe(TEXT);
  });
});

describe('reject', () => {
  it('marks rejected without touching the text and records the revision', () => {
    const session = newSession([GRAMMAR_LOWER()]);
    const outcome = session.reject('s-minuscola');
    if (!outcome.ok) throw new Error('reject failed');
    expect(outcome.revision).toMatchObject({ before: 'aprì', after: 'Aprì', decision: 'rejected' });
    expect(session.text).toBe(TEXT);
    expect(session.suggestions[0].state).toBe('rejected');
    expect(session.canUndo).toBe(true);
  });
});

describe('acceptAll (patches from the highest offset to the lowest)', () => {
  it('accepts all pendings of the category in a single command', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_LOWER(), GRAMMAR_ELISION()]);
    const outcome = session.acceptAll('grammar');
    expect(outcome.accepted).toBe(2);
    expect(outcome.staled).toBe(0);
    expect(session.text).toBe(
      "Posò lentamente il telefono. Aprì la finestra e un'altra tazza cadde.",
    );
    // style stays pending, with its span intact (the patches were further ahead)
    expect(session.pendingOf('style')).toHaveLength(1);
    // a single undo restores both
    const undo = session.undo();
    if (!undo.ok) throw new Error('undo failed');
    expect(undo.text).toBe(TEXT);
    expect(undo.removedRevisionIds).toHaveLength(2);
    expect(session.pendingOf('grammar')).toHaveLength(2);
  });

  it('never accepts history hints: they are accepted one at a time', () => {
    const session = newSession([
      sug('s-storico', 'history', 'Posò lentamente', ['Posò piano'], { aspect: 'anachronism' }),
    ]);
    const outcome = session.acceptAll('history');
    expect(outcome).toMatchObject({ accepted: 0, staled: 0, revisions: [] });
    expect(session.pendingOf('history')).toHaveLength(1);
    expect(session.canUndo).toBe(false);
  });

  it('without pendings in the category it produces no commands', () => {
    const session = newSession([STYLE_ADVERB()]);
    const outcome = session.acceptAll('grammar');
    expect(outcome).toMatchObject({ accepted: 0, staled: 0, revisions: [] });
    expect(session.canUndo).toBe(false);
  });
});

describe('undo (LIFO over the local history)', () => {
  it('restores text, states and spans to the previous situation', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_ELISION()]);
    session.accept('s-avverbio', 0);
    const undone = session.undo();
    if (!undone.ok) throw new Error('undo failed');
    expect(session.text).toBe(TEXT);
    const style = session.suggestions.find((s) => s.id === 's-avverbio');
    expect(style).toMatchObject({ state: 'pending' });
    expect(style?.acceptedProposal).toBeUndefined();
    const elision = session.suggestions.find((s) => s.id === 's-elisione');
    expect(session.text.slice(elision!.span.from, elision!.span.to)).toBe('un altra');
  });

  it('two accepts are undone in reverse order', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_ELISION()]);
    session.accept('s-avverbio', 0);
    session.accept('s-elisione', 0);
    expect(session.undo().ok).toBe(true); // undoes the elision
    expect(session.text).toBe('Posò il telefono. aprì la finestra e un altra tazza cadde.');
    expect(session.undo().ok).toBe(true); // undoes the adverb
    expect(session.text).toBe(TEXT);
    expect(session.undo()).toEqual({ ok: false, reason: 'nothing-to-undo' });
  });

  it('undoing a reject returns the suggestion to pending', () => {
    const session = newSession([GRAMMAR_LOWER()]);
    session.reject('s-minuscola');
    const undone = session.undo();
    expect(undone.ok).toBe(true);
    expect(session.suggestions[0].state).toBe('pending');
  });
});

describe('manual edit', () => {
  it('an edit touching a pending span invalidates it (stale)', () => {
    const session = newSession([GRAMMAR_LOWER(), GRAMMAR_ELISION()]);
    // the user hand-corrects 'aprì' → 'Aprì'
    const edited = TEXT.replace('. aprì', '. Aprì');
    const outcome = session.applyManualEdit(edited);
    expect(outcome).toEqual({ changed: true, staled: 1 });
    expect(session.suggestions.find((s) => s.id === 's-minuscola')?.state).toBe('stale');
    // the other pending survives, re-mapped onto the new text
    const elision = session.suggestions.find((s) => s.id === 's-elisione');
    expect(elision?.state).toBe('pending');
    expect(session.text.slice(elision!.span.from, elision!.span.to)).toBe('un altra');
  });

  it('an edit before a span shifts it by the delta', () => {
    const session = newSession([GRAMMAR_ELISION()]);
    const edited = `C'era silenzio. ${TEXT}`;
    session.applyManualEdit(edited);
    const elision = session.suggestions[0];
    expect(elision.state).toBe('pending');
    expect(session.text.slice(elision.span.from, elision.span.to)).toBe('un altra');
  });

  it('clears the undo history (the inverses no longer describe the text)', () => {
    const session = newSession([STYLE_ADVERB()]);
    session.accept('s-avverbio', 0);
    expect(session.canUndo).toBe(true);
    session.applyManualEdit(`${session.text} Fine.`);
    expect(session.canUndo).toBe(false);
    expect(session.undo()).toEqual({ ok: false, reason: 'nothing-to-undo' });
  });

  it('identical text: no change', () => {
    const session = newSession([GRAMMAR_LOWER()]);
    expect(session.applyManualEdit(TEXT)).toEqual({ changed: false, staled: 0 });
    expect(session.canUndo).toBe(false);
  });
});

describe('a new batch clears the history (stated assumption)', () => {
  it('after an ingest undo is no longer available', () => {
    const session = newSession([STYLE_ADVERB()]);
    session.accept('s-avverbio', 0);
    expect(session.canUndo).toBe(true);
    session.ingest({ textHash: textHash(session.text), suggestions: [] });
    expect(session.canUndo).toBe(false);
  });
});

describe('accept never deletes or replaces text silently (phone test, 21 Oct)', () => {
  const PHONE_TEXT =
    "L'uomo osservò L'uomo osserva Allora sto cercando di dettare. Era tardi punto e virgola nessuno rispose.";
  const at = (fragment: string) => {
    const from = PHONE_TEXT.indexOf(fragment);
    return { from, to: from + fragment.length };
  };
  const phoneSug = (
    id: string,
    kind: SuggestionKind,
    original: string,
    proposal: string,
  ): Suggestion => ({
    id,
    kind,
    span: at(original),
    original,
    proposals: [proposal],
    rationale: 'prova',
    state: 'pending',
    textHash: textHash(PHONE_TEXT),
  });
  const session = (suggestions: Suggestion[]) => {
    const s = new ReviewSession({ initialText: PHONE_TEXT, now: () => 1 });
    s.ingest({ textHash: textHash(PHONE_TEXT), suggestions });
    return s;
  };

  it('a grammar «fix» that deletes half the sentence is refused, the text is intact', () => {
    const s = session([
      phoneSug(
        'g1',
        'grammar',
        "L'uomo osservò L'uomo osserva Allora sto cercando di dettare.",
        "L'uomo osservò.",
      ),
    ]);
    expect(s.accept('g1')).toEqual({ ok: false, reason: 'unsafe-proposal' });
    expect(s.text).toBe(PHONE_TEXT);
    expect(s.suggestions[0]?.state).toBe('stale');
  });

  it('a proposal unrelated to its original is refused', () => {
    const s = session([phoneSug('g2', 'grammar', 'punto e virgola', ". L'uomo osservò.")]);
    expect(s.accept('g2')).toEqual({ ok: false, reason: 'unsafe-proposal' });
    expect(s.text).toBe(PHONE_TEXT);
  });

  it('a real fix is still applied', () => {
    const s = session([phoneSug('g3', 'grammar', 'punto e virgola', ';')]);
    expect(s.accept('g3')).toMatchObject({ ok: true });
    expect(s.text).toContain('Era tardi ; nessuno');
  });

  it('accept all skips the unsafe ones and says how many', () => {
    const s = session([
      phoneSug(
        'g1',
        'grammar',
        "L'uomo osservò L'uomo osserva Allora sto cercando di dettare.",
        "L'uomo osservò.",
      ),
      phoneSug('g3', 'grammar', 'punto e virgola', ';'),
    ]);
    const outcome = s.acceptAll('grammar');
    expect(outcome).toMatchObject({ accepted: 1, unsafe: 1 });
    expect(s.text).toContain("L'uomo osserva Allora sto cercando di dettare.");
  });

  it('a misplaced suggestion (span no longer on its original) is never applied', () => {
    const misplaced = {
      ...phoneSug('g4', 'grammar', 'punto e virgola', ';'),
      span: at('Era tardi'),
    };
    const s = session([misplaced]);
    expect(s.accept('g4')).toMatchObject({ ok: false });
    expect(s.text).toBe(PHONE_TEXT);
  });
});
