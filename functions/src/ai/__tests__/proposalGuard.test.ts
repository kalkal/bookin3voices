// Proposals must change the original, not replace it. Seen on the phone (21 Oct):
// a grammar fix that deleted half a sentence, and an «accepted» proposal that
// had nothing to do with its original.

import { normalizeSuggestions } from '../normalizeSuggestions';
import { checkProposal } from '../proposalGuard';
import type { ModelOutput } from '../refineTypes';
import { textHash } from '../textHash';

const grammar = (original: string, proposal: string) =>
  checkProposal('grammar', original, proposal);
const style = (original: string, proposal: string) => checkProposal('style', original, proposal);

describe('checkProposal: grammar is a small edit', () => {
  it('drops a «fix» that deletes half the sentence (phone, 21 Oct)', () => {
    expect(
      grammar("L'uomo osservò L'uomo osserva Allora sto cercando di dettare.", "L'uomo osservò."),
    ).toMatchObject({ ok: false, reason: 'removes-words' });
  });

  it('drops a proposal unrelated to its original (phone, 21 Oct)', () => {
    expect(grammar('punto e virgola', ". L'uomo osservò.")).toMatchObject({
      ok: false,
      reason: 'adds-words',
    });
  });

  it.each([
    [
      'punctuation only',
      'il salvagente dal palo la corda era annodata male',
      'il salvagente dal palo. La corda era annodata male',
    ],
    ['capital letter', 'alle dieci si fece un tè', 'Alle dieci si fece un tè'],
    ['elision', 'un altra tazza', "un'altra tazza"],
    ['agreement', 'le casa era vuota', 'la casa era vuota'],
    ['accent', 'perche non era venuto', 'perché non era venuto'],
    [
      'spoken punctuation left in the text',
      'era tardi punto e virgola nessuno',
      'era tardi; nessuno',
    ],
    ['doubled phrase from dictation', 'la porta la porta si aprì', 'la porta si aprì'],
  ])('keeps a real fix: %s', (_label, original, proposal) => {
    expect(grammar(original, proposal)).toMatchObject({ ok: true });
  });

  it('a doubled phrase is fixed only if nothing else goes: extra words lost → dropped', () => {
    expect(grammar('la porta la porta si aprì piano nel buio', 'la porta si aprì')).toMatchObject({
      ok: false,
      reason: 'removes-words',
    });
  });
});

describe('checkProposal: the label the model picks does not matter', () => {
  it.each(['style', 'pacing'] as const)(
    'the phone cases are dropped when tagged %s too',
    (kind) => {
      expect(
        checkProposal(
          kind,
          "L'uomo osservò L'uomo osserva Allora sto cercando di dettare.",
          "L'uomo osservò.",
        ),
      ).toMatchObject({ ok: false, reason: 'removes-words' });
      expect(checkProposal(kind, 'punto e virgola', ". L'uomo osservò.")).toMatchObject({
        ok: false,
        reason: 'adds-words',
      });
    },
  );

  it.each(['style', 'pacing'] as const)(
    '%s: new words do not buy back lost ones (phone sentence + 1 word)',
    (kind) => {
      for (const proposal of ["L'uomo osservò stupito.", "L'uomo osservò in silenzio la stanza."]) {
        expect(
          checkProposal(
            kind,
            "L'uomo osservò L'uomo osserva Allora sto cercando di dettare.",
            proposal,
          ),
        ).toMatchObject({ ok: false, reason: 'removes-words' });
      }
    },
  );

  it.each(['style', 'pacing'] as const)(
    '%s: a short original cannot become a different sentence',
    (kind) => {
      expect(
        checkProposal(kind, 'indagò lei', 'Fuori pioveva da ore e nessuno parlò.'),
      ).toMatchObject({
        ok: false,
      });
    },
  );

  it.each(['style', 'pacing'] as const)(
    '%s: losing most of the content words is refused at every length',
    (kind) => {
      expect(checkProposal(kind, 'Toccò il muro freddo.', 'Toccò.')).toMatchObject({ ok: false });
      expect(
        checkProposal(
          kind,
          'Alle dieci e mezza notò che la macchia era cambiata, più scura al centro.',
          'Alle dieci.',
        ),
      ).toMatchObject({ ok: false, reason: 'removes-words' });
    },
  );
});

describe('checkProposal: style and pacing keep part of the original', () => {
  it('drops a long original rewritten into something unrelated', () => {
    expect(
      style(
        'Fabio si infilò il salvagente al braccio e afferrò il cavo del corrimano e salì sulla passerella',
        'Era una notte buia e tempestosa.',
      ),
    ).toMatchObject({ ok: false });
  });

  it.each([
    ['adverb cut', 'staccò freneticamente', 'staccò'],
    ['filter verb', "Si accorse che l'acqua aveva già coperto", "L'acqua aveva già coperto"],
    [
      'passive to active',
      'il palo del corrimano fu strappato dalla corrente',
      'la corrente strappò il palo del corrimano',
    ],
    [
      'show, do not tell (keeps its anchor words)',
      "Provava un'ansia crescente che non riusciva a spiegarsi",
      "Un'ansia crescente le stringeva lo stomaco, senza che sapesse spiegarsi perché.",
    ],
    ['dialogue tag', 'ammise Bruno sconsolatamente', 'disse Bruno'],
    ['dialogue tag (two words)', 'indagò lei', 'chiese lei'],
    [
      'dialogue tag with a gesture',
      'balbettò Bruno con un filo di voce',
      'disse Bruno con un filo di voce',
    ],
  ])('keeps a real rewrite: %s', (_label, original, proposal) => {
    expect(style(original, proposal)).toMatchObject({ ok: true });
  });

  it('history hints are not judged here (they name facts to check)', () => {
    expect(
      checkProposal('history', 'il telefono cellulare', 'il telefono a gettoni'),
    ).toMatchObject({
      ok: true,
    });
  });
});

describe('normalizeSuggestions drops unsafe proposals', () => {
  const TEXT =
    "L'uomo osservò L'uomo osserva Allora sto cercando di dettare. Era tardi punto e virgola nessuno rispose. La porta la porta si aprì.";
  const out = (suggestions: ModelOutput['suggestions']): ModelOutput => ({ suggestions });

  it('the phone cases are discarded and counted as unsafe; real fixes stay', () => {
    const result = normalizeSuggestions(
      out([
        {
          kind: 'grammar',
          original: "L'uomo osservò L'uomo osserva Allora sto cercando di dettare.",
          proposals: ["L'uomo osservò."],
          rationale: 'ripetizione',
        },
        {
          kind: 'grammar',
          original: 'punto e virgola',
          proposals: [". L'uomo osservò."],
          rationale: 'punteggiatura',
        },
        {
          kind: 'grammar',
          original: 'La porta la porta si aprì.',
          proposals: ['La porta si aprì.'],
          rationale: 'ripetizione da dettatura',
        },
      ]),
      TEXT,
      textHash(TEXT),
      'req-1',
    );
    expect(result.suggestions.map((s) => s.original)).toEqual(['La porta la porta si aprì.']);
    expect(result.unsafe).toBe(2);
    expect(result.discarded).toBe(2);
  });

  it('a style suggestion keeps only its safe proposals', () => {
    const text = 'Elena posò lentamente la tazza sul tavolo.';
    const result = normalizeSuggestions(
      out([
        {
          kind: 'style',
          original: 'Elena posò lentamente la tazza sul tavolo.',
          proposals: ['Elena posò la tazza sul tavolo.', 'Fuori pioveva da ore e nessuno parlò.'],
          rationale: 'avverbio',
        },
      ]),
      text,
      textHash(text),
      'req-2',
    );
    expect(result.suggestions[0]?.proposals).toEqual(['Elena posò la tazza sul tavolo.']);
    expect(result.unsafe).toBe(1);
    expect(result.discarded).toBe(0);
  });
});
