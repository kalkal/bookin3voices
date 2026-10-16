// Snapshot test del prompt di rifinitura (i prompt sono codice).
// Un refactor non deve cambiarli silenziosamente; una modifica VOLUTA aggiorna
// REFINE_PROMPT_VERSION, lo snapshot E rigioca il golden set (npm run golden).

import {
  buildRefinePrompt,
  REFINE_PROMPT_VERSION,
  REFINE_RESPONSE_SCHEMA,
  REFINE_TEMPERATURE,
} from '../refinePrompt';

const BASE_INPUT = {
  styleBible: '# Style Bible di prova\nRegola zero: la voce è intoccabile.',
  fewShots: '## Esempio 1\nTesto → suggerimento.',
  book: { title: 'Il faro', genre: 'thriller', language: 'it', synopsis: '' },
  chapter: { title: 'La tempesta', outline: null },
  text: 'Elena posò lentamente la tazza sul tavolo.',
};

describe('buildRefinePrompt', () => {
  it('la versione del prompt è quella attesa (bump SOLO deliberato)', () => {
    expect(REFINE_PROMPT_VERSION).toBe(1);
    expect(REFINE_TEMPERATURE).toBe(0.3);
  });

  it('snapshot: prompt minimo senza sinossi né outline', () => {
    expect(buildRefinePrompt(BASE_INPUT)).toMatchSnapshot();
  });

  it('snapshot: prompt con sinossi e outline (seconda metà dell’outline)', () => {
    expect(
      buildRefinePrompt({
        ...BASE_INPUT,
        book: { ...BASE_INPUT.book, synopsis: 'Un guardiano scopre che il faro chiama le navi.' },
        chapter: {
          title: 'La tempesta',
          outline: {
            summary: 'La prima notte di burrasca.',
            beats: ['Arriva la burrasca', 'La lampada si spegne'],
          },
        },
      }),
    ).toMatchSnapshot();
  });

  it('Style Bible e few-shot stanno nel prefisso stabile (system instruction)', () => {
    const prompt = buildRefinePrompt(BASE_INPUT);
    expect(prompt.systemInstruction).toContain('Style Bible di prova');
    expect(prompt.systemInstruction).toContain('Esempio 1');
    // il materiale variabile resta nello user text (caching implicito)
    expect(prompt.systemInstruction).not.toContain('Il faro');
    expect(prompt.userText).toContain('Elena posò lentamente');
  });

  it('senza outline/sinossi il contesto non contiene blocchi vuoti', () => {
    const prompt = buildRefinePrompt(BASE_INPUT);
    expect(prompt.userText).not.toContain('Sinossi');
    expect(prompt.userText).not.toContain('Traccia del capitolo');
  });

  it('outline: beat numerati e avvertenza solo-contesto', () => {
    const prompt = buildRefinePrompt({
      ...BASE_INPUT,
      chapter: {
        title: 'La tempesta',
        outline: { summary: 'Sommario.', beats: ['Primo beat', 'Secondo beat'] },
      },
    });
    expect(prompt.userText).toContain('1. Primo beat');
    expect(prompt.userText).toContain('2. Secondo beat');
    expect(prompt.userText).toContain('NON suggerire modifiche di trama');
  });

  it('niente minItems/maxItems nello schema (l’endpoint li rifiuta con 400)', () => {
    const flat = JSON.stringify(REFINE_RESPONSE_SCHEMA);
    expect(flat).not.toContain('minItems');
    expect(flat).not.toContain('maxItems');
  });

  it('fallback per titoli e lingua vuoti', () => {
    const prompt = buildRefinePrompt({
      ...BASE_INPUT,
      book: { title: '', genre: '', language: '', synopsis: '' },
      chapter: { title: '', outline: null },
    });
    expect(prompt.userText).toContain('«senza titolo»');
    expect(prompt.userText).toContain('Lingua del libro: it');
    expect(prompt.userText).toContain('Genere: non indicato');
  });
});
