// Snapshot test of the outline prompt (prompts are code; a refactor must not
// change them silently). An INTENTIONAL prompt change updates
// OUTLINE_PROMPT_VERSION and these snapshots together.

import { buildOutlinePrompt, OUTLINE_PROMPT_VERSION, outlineStyleOf } from '../outlinePrompt';

const SINOSSI_FITTIZIA = [
  'Viola, apicoltrice, rileva le arnie abbandonate di un apicoltore scomparso',
  'nella valle di Rocca Bassa e scopre nei quaderni del vecchio mulino',
  'annotazioni su sciami mai tornati alle arnie.',
].join(' ');

describe('buildOutlinePrompt', () => {
  const base = {
    synopsis: SINOSSI_FITTIZIA,
    book: { title: 'Il mulino di Rocca Bassa', genre: 'romanzo', language: 'it' },
    style: 'suspense' as const,
    writtenChapterTitles: [],
  };

  it('the prompt version is the expected one (explicit bump on every change)', () => {
    expect(OUTLINE_PROMPT_VERSION).toBe(2);
  });

  it('snapshot without already-written chapters', () => {
    expect(buildOutlinePrompt(base)).toMatchSnapshot();
  });

  it('snapshot with already-written chapters (context)', () => {
    expect(
      buildOutlinePrompt({
        ...base,
        writtenChapterTitles: ['Il ritorno', 'Il registro'],
      }),
    ).toMatchSnapshot();
  });

  it('already-written chapters enter the user text as a numbered list', () => {
    const prompt = buildOutlinePrompt({
      ...base,
      writtenChapterTitles: ['Il ritorno', 'Il registro'],
    });
    expect(prompt.userText).toContain('1. Il ritorno');
    expect(prompt.userText).toContain('2. Il registro');
    expect(prompt.userText).toContain('non riproporli');
  });

  it('without written chapters the block does not appear', () => {
    expect(buildOutlinePrompt(base).userText).not.toContain('GIÀ SCRITTI');
  });

  it('empty genre and language have a readable fallback', () => {
    const prompt = buildOutlinePrompt({
      ...base,
      book: { title: 'Senza meta', genre: '', language: '' },
    });
    expect(prompt.userText).toContain('Genere: non indicato');
    expect(prompt.userText).toContain('Lingua del libro: it');
  });

  it('the response schema does NOT contain minItems/maxItems (the endpoint rejects them)', () => {
    const flat = JSON.stringify(buildOutlinePrompt(base).responseSchema);
    expect(flat).not.toContain('minItems');
    expect(flat).not.toContain('maxItems');
    expect(flat).toContain('"required":["title","summary","beats"]');
  });

  it.each([
    ['suspense', 'Suspense / Horror', /minaccia/],
    ['mystery', 'Mystery (giallo)', /indizi/],
    ['thriller', 'Thriller', /scadenza/],
  ] as const)('the %s style of the book shapes the outline', (style, label, craft) => {
    const prompt = buildOutlinePrompt({ ...base, style });
    expect(prompt.userText).toContain(`Stile del libro: ${label}`);
    expect(prompt.userText).toMatch(craft);
    expect(prompt.systemInstruction).toContain('stile del libro');
  });

  it('a different style gives a different prompt (the style is not ignored)', () => {
    const mystery = buildOutlinePrompt({ ...base, style: 'mystery' });
    const thriller = buildOutlinePrompt({ ...base, style: 'thriller' });
    expect(mystery.userText).not.toBe(thriller.userText);
  });
});

describe('outlineStyleOf', () => {
  it('the style sent by the app wins (the user may have just changed it)', () => {
    expect(outlineStyleOf('thriller', 'mystery')).toBe('thriller');
  });

  it('without one, the style saved on the book', () => {
    expect(outlineStyleOf(undefined, 'mystery')).toBe('mystery');
  });

  it('nothing known → the default style', () => {
    expect(outlineStyleOf(undefined, null)).toBe('suspense');
    expect(outlineStyleOf(undefined, 'romance')).toBe('suspense');
  });
});
