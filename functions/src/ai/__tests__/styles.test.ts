// Every style has its own instructions and examples, the book's choice reaches
// the prompt (for any provider, the prompt is provider-neutral) and an unknown
// style falls back to the default.

import { buildPromptForBook } from '../refineChapter';
import { buildRefinePrompt } from '../refinePrompt';
import { DEFAULT_STYLE_ID, resolveStyleId, STYLES, STYLE_IDS, type StyleId } from '../styles';
import { loadStyleProfileContent } from '../styleProfileContent';

/** Distinctive vocabulary of each style (lower case, English instructions). */
const MARKERS: Record<StyleId, string[]> = {
  suspense: ['threat the reader has not yet seen', 'sensory detail', 'show the unease'],
  mystery: ['fair play', 'red herrings', 'clue'],
  thriller: ['deadline', 'cliffhanger', 'short sentences'],
};

/** The "Text" blockquote of every few-shot example. */
function exampleTexts(fewShots: string): string[] {
  const out: string[] = [];
  const pattern = /\*\*(?:Testo|Text):\*\*\n((?:>.*\n?)+)/g;
  for (const match of fewShots.matchAll(pattern)) {
    out.push((match[1] ?? '').replace(/^>\s?/gm, '').replace(/\s+/g, ' ').trim());
  }
  return out;
}

describe('style registry', () => {
  it('has suspense, mystery and thriller with en and it labels', () => {
    expect(STYLES.map((s) => s.id)).toEqual([...STYLE_IDS]);
    expect(STYLE_IDS).toEqual(['suspense', 'mystery', 'thriller']);
    for (const style of STYLES) {
      expect(style.label.en).not.toBe('');
      expect(style.label.it).not.toBe('');
      expect(style.summary.en).not.toBe('');
    }
  });

  it('no style mentions a real author', () => {
    const everything =
      JSON.stringify(STYLES) +
      STYLE_IDS.map((id) => {
        const p = loadStyleProfileContent(id);
        return p.styleBible + p.fewShots;
      }).join('\n');
    expect(everything).not.toMatch(/stephen|\bking\b|christie|doyle|patterson|grisham|on writing/i);
  });

  it('unknown or missing style resolves to the default', () => {
    expect(DEFAULT_STYLE_ID).toBe('suspense');
    for (const raw of [undefined, null, '', 'skynet', 42, 'MYSTERY']) {
      expect(resolveStyleId(raw)).toBe('suspense');
    }
    expect(resolveStyleId('mystery')).toBe('mystery');
    expect(resolveStyleId('thriller')).toBe('thriller');
  });
});

describe.each(STYLE_IDS)('style "%s"', (id) => {
  const profile = loadStyleProfileContent(id);

  it('has instructions with its own traits and none of the other styles', () => {
    const bible = profile.styleBible.toLowerCase();
    for (const marker of MARKERS[id]) expect(bible).toContain(marker);
    for (const other of STYLE_IDS.filter((o) => o !== id)) {
      for (const marker of MARKERS[other]) expect(bible).not.toContain(marker);
    }
  });

  it('has at least three invented examples', () => {
    expect(exampleTexts(profile.fewShots).length).toBeGreaterThanOrEqual(3);
  });
});

describe('examples differ between styles', () => {
  it('no example text is shared between two styles, and none repeats inside a style', () => {
    const all = STYLE_IDS.flatMap((id) => exampleTexts(loadStyleProfileContent(id).fewShots));
    expect(new Set(all).size).toBe(all.length);
  });

  it('the three genre-voice examples are distinct', () => {
    const voices = [/Elena had not run it/, /stopped at ten past nine/, /Twelve minutes/];
    const profiles = STYLE_IDS.map((id) => loadStyleProfileContent(id).fewShots);
    voices.forEach((voice, index) => {
      expect(profiles[index]).toMatch(voice);
      profiles.forEach((text, other) => {
        if (other !== index) expect(text).not.toMatch(voice);
      });
    });
  });
});

describe('the chosen style reaches the prompt', () => {
  const build = (id: StyleId) => {
    const profile = loadStyleProfileContent(id);
    return buildRefinePrompt({
      styleBible: profile.styleBible,
      fewShots: profile.fewShots,
      book: { title: 'T', genre: '', language: 'en', synopsis: '' },
      chapter: { title: 'C', outline: null },
      text: 'Some text.',
    });
  };

  it('each style yields a different system instruction carrying its own rules', () => {
    const systems = STYLE_IDS.map((id) => build(id).systemInstruction);
    expect(new Set(systems).size).toBe(3);
    expect(systems[1]).toContain('Fair play');
    expect(systems[2]).toContain('Cliffhanger');
    expect(systems[0]).toContain('threat the reader has not yet seen');
  });

  it('the JSON contract is identical whatever the style', () => {
    const schemas = STYLE_IDS.map((id) => JSON.stringify(build(id).responseSchema));
    expect(new Set(schemas).size).toBe(1);
  });
});

describe('buildPromptForBook (the book choice reaches the loader and the prompt)', () => {
  const base = { title: 'T', genre: '', language: 'en', synopsis: '' };
  const chapter = { title: 'C', outline: null };

  function run(styleProfileId: string | null) {
    const requested: string[] = [];
    const prompt = buildPromptForBook({
      book: { ...base, styleProfileId },
      chapter,
      text: 'Some text.',
      loadStyleProfile: (id) => {
        requested.push(id);
        return loadStyleProfileContent(id as StyleId);
      },
    });
    return { requested, prompt };
  }

  it.each(STYLE_IDS)('book style "%s" loads that style', (id) => {
    const { requested, prompt } = run(id);
    expect(requested).toEqual([id]);
    expect(prompt.systemInstruction).toContain(loadStyleProfileContent(id).styleBible.trim());
  });

  it('null or unknown book style loads the default', () => {
    expect(run(null).requested).toEqual(['suspense']);
    expect(run('not-a-style').requested).toEqual(['suspense']);
  });
});
