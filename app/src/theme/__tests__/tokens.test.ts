import { candlelightPalette, paperPalette, radius, spacing, typeScale } from '../tokens';

describe('palette carta (tabella token, valori esatti)', () => {
  it.each([
    ['background', '#F5EFE0'],
    ['surface', '#FBF6EA'],
    ['text', '#2C241B'],
    ['textMuted', '#8A7B63'],
    ['primary', '#2E5343'],
    ['accent', '#A8853B'],
    ['accentLight', '#C9A961'],
    ['hairline', '#D9CDB4'],
  ] as const)('%s = %s', (token, expected) => {
    expect(paperPalette[token]).toBe(expected);
  });
});

describe('palette a lume di candela (abbozzo)', () => {
  it('ha fondo bruno scuro e testo ambrato, diversi dal tema carta', () => {
    expect(candlelightPalette.background).not.toBe(paperPalette.background);
    expect(candlelightPalette.text).not.toBe(paperPalette.text);
  });

  it('copre le stesse chiavi della palette carta', () => {
    expect(Object.keys(candlelightPalette).sort()).toEqual(Object.keys(paperPalette).sort());
  });
});

describe('raggi e spaziature', () => {
  it('gli angoli sono quasi vivi: 3px', () => {
    expect(radius.sharp).toBe(3);
  });

  it('la scala di spaziatura è crescente', () => {
    const values = [
      spacing.xs,
      spacing.sm,
      spacing.md,
      spacing.lg,
      spacing.xl,
      spacing.xxl,
      spacing.xxxl,
    ];
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });

  it('la scala tipografica è crescente dal micro al display', () => {
    expect(typeScale.micro).toBeLessThan(typeScale.body);
    expect(typeScale.body).toBeLessThan(typeScale.title);
    expect(typeScale.title).toBeLessThan(typeScale.display);
  });
});
