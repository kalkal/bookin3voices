// Validation of the outline at the boundary (parse, don't validate): never
// trust the model's JSON; deterministic sanitize + Zod schema.

import { sanitizeOutlineCandidate } from '../generateOutline';
import { generateOutlineInputSchema, outlineSchema } from '../types';

const capitolo = (extra: Partial<Record<string, unknown>> = {}) => ({
  title: 'Il ritorno',
  summary: 'Nora torna sull’isola dopo diciassette anni.',
  beats: ['Il traghetto attracca', 'La valigia troppo pesante', 'La casa dello zio'],
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
          title: ' L’isola della ruggine ',
          summary: ' Nora arriva sull’isola. ',
          beats: ['L’arrivo', ' Il faro spento ', ''],
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

  it('rejects a requestId with characters unsafe for a Firestore id', () => {
    expect(generateOutlineInputSchema.safeParse({ ...valido, requestId: 'a/b' }).success).toBe(
      false,
    );
  });
});
