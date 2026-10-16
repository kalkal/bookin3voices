// Validazione al confine dell'outline (parse, don't validate):
// mai fidarsi del JSON di Gemini — sanitize deterministico + schema Zod.

import { sanitizeOutlineCandidate } from '../generateOutline';
import { generateOutlineInputSchema, outlineSchema } from '../types';

const capitolo = (extra: Partial<Record<string, unknown>> = {}) => ({
  title: 'Il ritorno',
  summary: 'Nora torna sull’isola dopo diciassette anni.',
  beats: ['Il traghetto attracca', 'La valigia troppo pesante', 'La casa dello zio'],
  ...extra,
});

describe('outlineSchema', () => {
  it('accetta un outline conforme', () => {
    const parsed = outlineSchema.safeParse({ chapters: [capitolo()] });
    expect(parsed.success).toBe(true);
  });

  it('rifiuta un outline senza capitoli', () => {
    expect(outlineSchema.safeParse({ chapters: [] }).success).toBe(false);
  });

  it('rifiuta un capitolo senza beat', () => {
    expect(outlineSchema.safeParse({ chapters: [capitolo({ beats: [] })] }).success).toBe(false);
  });

  it('rifiuta più di 8 beat (guardrail sull’output del modello)', () => {
    const beats = Array.from({ length: 9 }, (_, i) => `beat ${i + 1}`);
    expect(outlineSchema.safeParse({ chapters: [capitolo({ beats })] }).success).toBe(false);
  });

  it('rifiuta titoli vuoti anche dopo il trim', () => {
    expect(outlineSchema.safeParse({ chapters: [capitolo({ title: '   ' })] }).success).toBe(false);
  });
});

describe('sanitizeOutlineCandidate', () => {
  it('trim dei testi e beat vuoti scartati', () => {
    const sanitized = sanitizeOutlineCandidate({
      chapters: [capitolo({ title: '  Il ritorno  ', beats: [' a ', '', '  ', 'b'] })],
    });
    expect(sanitized).toEqual({
      chapters: [capitolo({ title: 'Il ritorno', beats: ['a', 'b'] })],
    });
  });

  it('non inventa struttura: i candidati non-oggetto passano invariati (li boccia Zod)', () => {
    expect(sanitizeOutlineCandidate(null)).toBeNull();
    expect(sanitizeOutlineCandidate('testo')).toBe('testo');
    expect(sanitizeOutlineCandidate({ chapters: 'niente array' })).toEqual({
      chapters: 'niente array',
    });
    expect(sanitizeOutlineCandidate({ chapters: [42] })).toEqual({ chapters: [42] });
  });

  it('dopo il sanitize un candidato reale con spazi passa lo schema', () => {
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

  it('accetta input validi', () => {
    expect(generateOutlineInputSchema.safeParse(valido).success).toBe(true);
  });

  it('rifiuta sinossi vuota (anche solo spazi)', () => {
    expect(generateOutlineInputSchema.safeParse({ ...valido, synopsis: '   ' }).success).toBe(
      false,
    );
  });

  it('rifiuta requestId con caratteri non sicuri per un id Firestore', () => {
    expect(generateOutlineInputSchema.safeParse({ ...valido, requestId: 'a/b' }).success).toBe(
      false,
    );
  });
});
