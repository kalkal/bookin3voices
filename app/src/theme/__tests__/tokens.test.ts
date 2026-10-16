import { candlelightPalette, paperPalette, radius, spacing, typeScale } from '../tokens';

describe('paper palette (token table, exact values)', () => {
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

describe('candlelight palette (sketch)', () => {
  it('has a dark brown background and amber text, different from the paper theme', () => {
    expect(candlelightPalette.background).not.toBe(paperPalette.background);
    expect(candlelightPalette.text).not.toBe(paperPalette.text);
  });

  it('covers the same keys as the paper palette', () => {
    expect(Object.keys(candlelightPalette).sort()).toEqual(Object.keys(paperPalette).sort());
  });
});

describe('radii and spacing', () => {
  it('corners are nearly sharp: 3px', () => {
    expect(radius.sharp).toBe(3);
  });

  it('the spacing scale is increasing', () => {
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

  it('the type scale is increasing from micro to display', () => {
    expect(typeScale.micro).toBeLessThan(typeScale.body);
    expect(typeScale.body).toBeLessThan(typeScale.title);
    expect(typeScale.title).toBeLessThan(typeScale.display);
  });
});
