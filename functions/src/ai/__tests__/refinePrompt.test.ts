// Snapshot test of the refinement prompt (prompts are code).
// A refactor must not change them silently; an INTENTIONAL change updates
// REFINE_PROMPT_VERSION and the snapshot AND replays the golden set
// (npm run golden).

import {
  buildRefinePrompt,
  REFINE_PROMPT_VERSION,
  REFINE_RESPONSE_SCHEMA,
  REFINE_TEMPERATURE,
} from '../refinePrompt';

const BASE_INPUT = {
  styleBible: '# Style Bible di prova\nRegola zero: la voce è intoccabile.',
  fewShots: '## Esempio 1\nTesto → suggerimento.',
  book: { title: 'Il mulino', genre: 'thriller', language: 'it', synopsis: '' },
  chapter: { title: 'La tempesta', outline: null },
  text: 'Elena posò lentamente la tazza sul tavolo.',
};

describe('buildRefinePrompt', () => {
  it('the prompt version is the expected one (bump ONLY on purpose)', () => {
    expect(REFINE_PROMPT_VERSION).toBe(3);
    expect(REFINE_TEMPERATURE).toBe(0.3);
  });

  it('snapshot: minimal prompt without synopsis or outline', () => {
    expect(buildRefinePrompt(BASE_INPUT)).toMatchSnapshot();
  });

  it('snapshot: prompt with synopsis and outline', () => {
    expect(
      buildRefinePrompt({
        ...BASE_INPUT,
        book: {
          ...BASE_INPUT.book,
          synopsis: 'La guardiana scopre che il mulino chiama gli sciami.',
        },
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

  it('Style Bible and few-shot sit in the stable prefix (system instruction)', () => {
    const prompt = buildRefinePrompt(BASE_INPUT);
    expect(prompt.systemInstruction).toContain('Style Bible di prova');
    expect(prompt.systemInstruction).toContain('Esempio 1');
    // the variable material stays in the user text (implicit caching)
    expect(prompt.systemInstruction).not.toContain('Il mulino');
    expect(prompt.userText).toContain('Elena posò lentamente');
  });

  it('without outline/synopsis the context has no empty blocks', () => {
    const prompt = buildRefinePrompt(BASE_INPUT);
    expect(prompt.userText).not.toContain('Sinossi');
    expect(prompt.userText).not.toContain('Traccia del capitolo');
  });

  it('outline: numbered beats and a context-only warning', () => {
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

  it('no minItems/maxItems in the schema (the endpoint rejects them with 400)', () => {
    const flat = JSON.stringify(REFINE_RESPONSE_SCHEMA);
    expect(flat).not.toContain('minItems');
    expect(flat).not.toContain('maxItems');
  });

  it('fallback for empty titles and language', () => {
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
