import { ReviewSession } from '../ReviewSession';
import { textHash } from '../textHash';
import type { RefineResult, Suggestion, SuggestionKind } from '../types';

const TEXT = 'Posò lentamente il bicchiere. aprì il rubinetto e un altra tazza cadde.';

/** Costruisce un suggerimento pending con lo span calcolato sul frammento. */
function sug(
  id: string,
  kind: SuggestionKind,
  fragment: string,
  proposals: string[],
  overrides: Partial<Suggestion> = {},
): Suggestion {
  const from = TEXT.indexOf(fragment);
  if (from === -1) throw new Error(`frammento non trovato: ${fragment}`);
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

describe('ingest (hash del testo)', () => {
  it('con hash combaciante i suggerimenti restano pending', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_LOWER()]);
    expect(session.pending).toHaveLength(2);
  });

  it('con hash diverso (testo cambiato durante la rifinitura) il lotto nasce stale', () => {
    const session = new ReviewSession({ initialText: TEXT });
    const outcome = session.ingest({ textHash: 'v1-altro', suggestions: [STYLE_ADVERB()] });
    expect(outcome.bornStale).toBe(true);
    expect(session.pending).toHaveLength(0);
    expect(session.suggestions[0].state).toBe('stale');
  });

  it('un suggerimento il cui original non combacia col testo nasce stale (mai fiducia cieca)', () => {
    const bugged = { ...STYLE_ADVERB(), original: 'Posò lentissimo', id: 's-bug' };
    bugged.span = { from: 0, to: bugged.original.length };
    const session = new ReviewSession({ initialText: TEXT });
    session.ingest(freshResult([bugged, GRAMMAR_LOWER()]));
    expect(session.suggestions.find((s) => s.id === 's-bug')?.state).toBe('stale');
    expect(session.pending).toHaveLength(1);
  });
});

describe('accept (Command con patch verificata)', () => {
  it('applica la variante scelta e registra la revisione', () => {
    const session = newSession([STYLE_ADVERB()]);
    const outcome = session.accept('s-avverbio', 1);
    if (!outcome.ok) throw new Error('accept fallita');
    expect(outcome.text).toBe(
      'Posò, piano, il bicchiere. aprì il rubinetto e un altra tazza cadde.',
    );
    expect(outcome.revision).toMatchObject({
      before: 'Posò lentamente',
      after: 'Posò, piano,',
      decision: 'accepted',
      at: 1000,
    });
    const accepted = session.suggestions.find((s) => s.id === 's-avverbio');
    expect(accepted).toMatchObject({ state: 'accepted', acceptedProposal: 1 });
  });

  it('ri-mappa gli span dei pending successivi', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_ELISION()]);
    const before = session.suggestions.find((s) => s.id === 's-elisione');
    if (!before) throw new Error('manca il suggerimento');
    session.accept('s-avverbio', 0); // 'Posò lentamente' → 'Posò': delta -11
    const after = session.suggestions.find((s) => s.id === 's-elisione');
    expect(after?.state).toBe('pending');
    expect(after?.span).toEqual({ from: before.span.from - 11, to: before.span.to - 11 });
    // lo span ri-mappato punta ancora al testo giusto
    expect(session.text.slice(after!.span.from, after!.span.to)).toBe('un altra');
  });

  it('un pending sovrapposto alla patch accettata diventa stale', () => {
    const overlapping = sug('s-sovrapposto', 'style', 'lentamente il', ['il']);
    const session = newSession([STYLE_ADVERB(), overlapping]);
    session.accept('s-avverbio', 0);
    expect(session.suggestions.find((s) => s.id === 's-sovrapposto')?.state).toBe('stale');
  });

  it('rifiuta pulito accept su suggerimento non pending o sconosciuto', () => {
    const session = newSession([STYLE_ADVERB()]);
    session.accept('s-avverbio', 0);
    expect(session.accept('s-avverbio', 0)).toEqual({ ok: false, reason: 'not-pending' });
    expect(session.accept('fantasma')).toEqual({ ok: false, reason: 'unknown-suggestion' });
    expect(session.accept('s-avverbio', 9)).toEqual({ ok: false, reason: 'not-pending' });
  });

  it('indice di proposta fuori range: rifiuto pulito senza toccare il testo', () => {
    const session = newSession([STYLE_ADVERB()]);
    expect(session.accept('s-avverbio', 3)).toEqual({ ok: false, reason: 'invalid-proposal' });
    expect(session.text).toBe(TEXT);
  });
});

describe('reject', () => {
  it('marca rejected senza toccare il testo e registra la revisione', () => {
    const session = newSession([GRAMMAR_LOWER()]);
    const outcome = session.reject('s-minuscola');
    if (!outcome.ok) throw new Error('reject fallita');
    expect(outcome.revision).toMatchObject({ before: 'aprì', after: 'Aprì', decision: 'rejected' });
    expect(session.text).toBe(TEXT);
    expect(session.suggestions[0].state).toBe('rejected');
    expect(session.canUndo).toBe(true);
  });
});

describe('acceptAll (patch dall’offset più alto al più basso)', () => {
  it('accetta tutti i pending della categoria in un solo comando', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_LOWER(), GRAMMAR_ELISION()]);
    const outcome = session.acceptAll('grammar');
    expect(outcome.accepted).toBe(2);
    expect(outcome.staled).toBe(0);
    expect(session.text).toBe(
      "Posò lentamente il bicchiere. Aprì il rubinetto e un'altra tazza cadde.",
    );
    // lo stile resta pending, con lo span intatto (le patch erano più avanti)
    expect(session.pendingOf('style')).toHaveLength(1);
    // un solo undo li ripristina tutti e due
    const undo = session.undo();
    if (!undo.ok) throw new Error('undo fallito');
    expect(undo.text).toBe(TEXT);
    expect(undo.removedRevisionIds).toHaveLength(2);
    expect(session.pendingOf('grammar')).toHaveLength(2);
  });

  it('senza pending della categoria non produce comandi', () => {
    const session = newSession([STYLE_ADVERB()]);
    const outcome = session.acceptAll('grammar');
    expect(outcome).toMatchObject({ accepted: 0, staled: 0, revisions: [] });
    expect(session.canUndo).toBe(false);
  });
});

describe('undo (LIFO sulla cronologia locale)', () => {
  it('ripristina testo, stati e span alla situazione precedente', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_ELISION()]);
    session.accept('s-avverbio', 0);
    const undone = session.undo();
    if (!undone.ok) throw new Error('undo fallito');
    expect(session.text).toBe(TEXT);
    const style = session.suggestions.find((s) => s.id === 's-avverbio');
    expect(style).toMatchObject({ state: 'pending' });
    expect(style?.acceptedProposal).toBeUndefined();
    const elision = session.suggestions.find((s) => s.id === 's-elisione');
    expect(session.text.slice(elision!.span.from, elision!.span.to)).toBe('un altra');
  });

  it('due accept si annullano in ordine inverso', () => {
    const session = newSession([STYLE_ADVERB(), GRAMMAR_ELISION()]);
    session.accept('s-avverbio', 0);
    session.accept('s-elisione', 0);
    expect(session.undo().ok).toBe(true); // annulla l'elisione
    expect(session.text).toBe('Posò il bicchiere. aprì il rubinetto e un altra tazza cadde.');
    expect(session.undo().ok).toBe(true); // annulla l'avverbio
    expect(session.text).toBe(TEXT);
    expect(session.undo()).toEqual({ ok: false, reason: 'nothing-to-undo' });
  });

  it('l’undo di un reject riporta il suggerimento pending', () => {
    const session = newSession([GRAMMAR_LOWER()]);
    session.reject('s-minuscola');
    const undone = session.undo();
    expect(undone.ok).toBe(true);
    expect(session.suggestions[0].state).toBe('pending');
  });
});

describe('edit manuale', () => {
  it('un edit che tocca lo span di un pending lo invalida (stale)', () => {
    const session = newSession([GRAMMAR_LOWER(), GRAMMAR_ELISION()]);
    // l'utente corregge a mano 'aprì' → 'Aprì'
    const edited = TEXT.replace('. aprì', '. Aprì');
    const outcome = session.applyManualEdit(edited);
    expect(outcome).toEqual({ changed: true, staled: 1 });
    expect(session.suggestions.find((s) => s.id === 's-minuscola')?.state).toBe('stale');
    // l'altro pending sopravvive, ri-mappato sul testo nuovo
    const elision = session.suggestions.find((s) => s.id === 's-elisione');
    expect(elision?.state).toBe('pending');
    expect(session.text.slice(elision!.span.from, elision!.span.to)).toBe('un altra');
  });

  it('un edit prima di uno span lo fa scorrere del delta', () => {
    const session = newSession([GRAMMAR_ELISION()]);
    const edited = `C'era silenzio. ${TEXT}`;
    session.applyManualEdit(edited);
    const elision = session.suggestions[0];
    expect(elision.state).toBe('pending');
    expect(session.text.slice(elision.span.from, elision.span.to)).toBe('un altra');
  });

  it('azzera la cronologia undo (le inverse non descrivono più il testo)', () => {
    const session = newSession([STYLE_ADVERB()]);
    session.accept('s-avverbio', 0);
    expect(session.canUndo).toBe(true);
    session.applyManualEdit(`${session.text} Fine.`);
    expect(session.canUndo).toBe(false);
    expect(session.undo()).toEqual({ ok: false, reason: 'nothing-to-undo' });
  });

  it('testo identico: nessun cambiamento', () => {
    const session = newSession([GRAMMAR_LOWER()]);
    expect(session.applyManualEdit(TEXT)).toEqual({ changed: false, staled: 0 });
    expect(session.canUndo).toBe(false);
  });
});

describe('un nuovo lotto azzera la cronologia (assunzione dichiarata)', () => {
  it('dopo un ingest l’undo non è più disponibile', () => {
    const session = newSession([STYLE_ADVERB()]);
    session.accept('s-avverbio', 0);
    expect(session.canUndo).toBe(true);
    session.ingest({ textHash: textHash(session.text), suggestions: [] });
    expect(session.canUndo).toBe(false);
  });
});
