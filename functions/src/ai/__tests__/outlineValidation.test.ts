// Validation of the outline at the boundary (parse, don't validate): never
// trust the model's JSON; deterministic sanitize + Zod schema.

import { sanitizeOutlineCandidate } from '../generateOutline';
import { generateOutlineInputSchema, outlineSchema } from '../types';

const capitolo = (extra: Partial<Record<string, unknown>> = {}) => ({
  title: 'Il ritorno',
  summary: 'Viola torna nella valle dopo diciassette anni.',
  beats: ['La corriera arriva in valle', 'La valigia troppo pesante', 'Il mulino sulla roggia'],
  ...extra,
});

describe('outlineSchema', () => {
  it('accepts a conforming outline', () => {
    const parsed = outlineSchema.safeParse({ chapters: [capitolo()] });
    expect(parsed.success).toBe(true);
  });

  it('rejects an outline without chapters', () => {
    expect(outlineSchema.safeParse({ chapters: [] }).success).toBe(false);
  });

  it('rejects a chapter without beats', () => {
    expect(outlineSchema.safeParse({ chapters: [capitolo({ beats: [] })] }).success).toBe(false);
  });

  it('rejects more than 8 beats (guardrail on the model output)', () => {
    const beats = Array.from({ length: 9 }, (_, i) => `beat ${i + 1}`);
    expect(outlineSchema.safeParse({ chapters: [capitolo({ beats })] }).success).toBe(false);
  });

  it('rejects empty titles even after trimming', () => {
    expect(outlineSchema.safeParse({ chapters: [capitolo({ title: '   ' })] }).success).toBe(false);
  });
});

describe('sanitizeOutlineCandidate', () => {
  it('trims texts and drops empty beats', () => {
    const sanitized = sanitizeOutlineCandidate({
      chapters: [capitolo({ title: '  Il ritorno  ', beats: [' a ', '', '  ', 'b'] })],
    });
    expect(sanitized).toEqual({
      chapters: [capitolo({ title: 'Il ritorno', beats: ['a', 'b'] })],
    });
  });

  it('invents no structure: non-object candidates pass through unchanged (Zod rejects them)', () => {
    expect(sanitizeOutlineCandidate(null)).toBeNull();
    expect(sanitizeOutlineCandidate('testo')).toBe('testo');
    expect(sanitizeOutlineCandidate({ chapters: 'niente array' })).toEqual({
      chapters: 'niente array',
    });
    expect(sanitizeOutlineCandidate({ chapters: [42] })).toEqual({ chapters: [42] });
  });

  it('after sanitize a real candidate with stray spaces passes the schema', () => {
    const candidate = {
      chapters: [
        {
          title: ' La valle delle arnie ',
          summary: ' Viola arriva al mulino. ',
          beats: ['L’arrivo', ' Il mulino fermo ', ''],
        },
      ],
    };
    expect(outlineSchema.safeParse(sanitizeOutlineCandidate(candidate)).success).toBe(true);
  });
});

describe('generateOutlineInputSchema', () => {
  const valido = { bookId: 'libro-1', synopsis: 'Una sinossi di prova.', requestId: 'out-abc_123' };

  it('accepts valid input', () => {
    expect(generateOutlineInputSchema.safeParse(valido).success).toBe(true);
  });

  it('rejects an empty synopsis (even whitespace only)', () => {
    expect(generateOutlineInputSchema.safeParse({ ...valido, synopsis: '   ' }).success).toBe(
      false,
    );
  });

  it('accepts the book style, and still accepts older clients that do not send it', () => {
    for (const styleId of ['suspense', 'mystery', 'historical']) {
      expect(generateOutlineInputSchema.safeParse({ ...valido, styleId }).success).toBe(true);
    }
    // an app from before the switch may still send the retired thriller style
    const legacy = generateOutlineInputSchema.safeParse({ ...valido, styleId: 'thriller' });
    expect(legacy.success && legacy.data.styleId).toBe('historical');
    expect(generateOutlineInputSchema.safeParse(valido).success).toBe(true);
  });

  it('rejects an unknown style', () => {
    expect(generateOutlineInputSchema.safeParse({ ...valido, styleId: 'romance' }).success).toBe(
      false,
    );
  });

  it('rejects a requestId with characters unsafe for a Firestore id', () => {
    expect(generateOutlineInputSchema.safeParse({ ...valido, requestId: 'a/b' }).success).toBe(
      false,
    );
  });
});
