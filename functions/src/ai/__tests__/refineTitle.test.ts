// «Rifinisci il titolo»: the chapter title lives in the chapter document, not
// in rawText, so it has its own small callable. Pure parts and the handler with
// injected fakes (no Firestore, no model).

import { HttpsError } from 'firebase-functions/v2/https';

import {
  buildTitlePrompt,
  normalizeTitleProposals,
  refineTitleInputSchema,
  runRefineTitle,
  TITLE_CONTEXT_CHARS,
  type RefineTitleDeps,
} from '../refineTitle';

const INPUT = { bookId: 'b1', chapterId: 'c1', title: 'La piena', requestId: 'tit-1' };
const CONTEXT = {
  book: { title: 'Il mulino', genre: 'thriller', language: 'it', synopsis: 'Una valle allagata.' },
  chapter: {
    title: 'La piena',
    rawText: 'Il torrente salì nella notte e portò via la passerella.',
  },
};

describe('input', () => {
  it('title required and bounded, requestId safe', () => {
    expect(refineTitleInputSchema.safeParse(INPUT).success).toBe(true);
    expect(refineTitleInputSchema.safeParse({ ...INPUT, title: '' }).success).toBe(true);
    expect(refineTitleInputSchema.safeParse({ ...INPUT, title: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(refineTitleInputSchema.safeParse({ ...INPUT, requestId: 'no spaces!' }).success).toBe(
      false,
    );
  });
});

describe('prompt', () => {
  it('carries the current title, the book context and a bounded excerpt of the chapter', () => {
    const long = { ...CONTEXT, chapter: { ...CONTEXT.chapter, rawText: 'parola '.repeat(5000) } };
    const prompt = buildTitlePrompt(long, 'La piena');
    expect(prompt.userText).toContain('«La piena»');
    expect(prompt.userText).toContain('Una valle allagata.');
    expect(prompt.userText.length).toBeLessThan(TITLE_CONTEXT_CHARS + 1500);
    expect(prompt.responseSchema).toMatchObject({ type: 'object' });
  });
});

describe('normalizeTitleProposals', () => {
  it('trims, unquotes, drops empty, unchanged, too long and duplicate titles, max 3', () => {
    expect(
      normalizeTitleProposals(
        [
          '  «La notte della piena»  ',
          'La piena',
          '"Acqua alta"',
          '',
          'x'.repeat(81),
          'Acqua alta',
          'Il ponte',
          'Il guado',
        ],
        'La piena',
      ),
    ).toEqual(['La notte della piena', 'Acqua alta', 'Il ponte']);
  });

  it('a multi-line answer is not a title', () => {
    expect(normalizeTitleProposals(['Primo\nsecondo'], 'X')).toEqual([]);
  });
});

describe('runRefineTitle', () => {
  function deps(
    answers: unknown[],
  ): RefineTitleDeps & { calls: () => number; limited: () => number } {
    let calls = 0;
    let limited = 0;
    return {
      loadContext: async () => CONTEXT,
      enforceLimit: async () => {
        limited += 1;
      },
      model: {
        modelName: 'amazon.nova-pro-v1:0',
        generate: async () => answers[Math.min(calls++, answers.length - 1)],
      },
      log: () => {},
      calls: () => calls,
      limited: () => limited,
    };
  }

  it('returns the cleaned proposals and the model', async () => {
    const d = deps([{ proposals: ['La notte della piena', 'La piena'], rationale: 'r' }]);
    await expect(runRefineTitle(d, 'u1', INPUT)).resolves.toEqual({
      requestId: 'tit-1',
      model: 'amazon.nova-pro-v1:0',
      proposals: ['La notte della piena'],
    });
    expect(d.limited()).toBe(1);
  });

  it('retries once on a malformed answer, then fails with a clear code', async () => {
    const d = deps([{ wrong: true }, { proposals: ['Acqua alta'] }]);
    await expect(runRefineTitle(d, 'u1', INPUT)).resolves.toMatchObject({
      proposals: ['Acqua alta'],
    });
    const bad = deps([{ wrong: true }]);
    await expect(runRefineTitle(bad, 'u1', INPUT)).rejects.toMatchObject({ code: 'internal' });
    expect(bad.calls()).toBe(2);
  });

  it('logs requestId and counts, never the title or the text', async () => {
    const lines: unknown[] = [];
    const d = {
      ...deps([{ proposals: ['Acqua alta'] }]),
      log: (msg: string, data: object) => lines.push([msg, data]),
    };
    await runRefineTitle(d, 'u1', INPUT);
    expect(lines).toEqual([
      [
        'refineTitle: proposals',
        { requestId: 'tit-1', model: 'amazon.nova-pro-v1:0', proposals: 1, dropped: 0 },
      ],
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/piena|Acqua|torrente/);
  });

  it('a chapter that does not exist is not-found', async () => {
    const d = {
      ...deps([]),
      loadContext: async () => {
        throw new HttpsError('not-found', 'Chapter not found.');
      },
    };
    await expect(runRefineTitle(d, 'u1', INPUT)).rejects.toMatchObject({ code: 'not-found' });
  });
});
