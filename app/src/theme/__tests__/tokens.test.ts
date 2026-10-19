import { candlelightPalette, paperPalette, radius, spacing, typeScale } from '../tokens';

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

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

describe('black and gold palette (the default look, mode "candlelight")', () => {
  it.each([
    ['background', '#121012'],
    ['surface', '#1C191C'],
    ['text', '#F5EFE0'],
    ['primary', '#C9A24E'],
    ['accent', '#C9A24E'],
    ['onPrimary', '#121012'],
    ['onAccent', '#121012'],
  ] as const)('%s = %s', (token, expected) => {
    expect(candlelightPalette[token]).toBe(expected);
  });

  it('covers the same keys as the paper palette', () => {
    expect(Object.keys(candlelightPalette).sort()).toEqual(Object.keys(paperPalette).sort());
  });

  // WCAG AA: 4.5 for text, 3 for the borders of controls
  it.each([
    ['text', 'background'],
    ['text', 'surface'],
    ['textMuted', 'background'],
    ['textMuted', 'surface'],
    ['textMutedStrong', 'background'],
    ['accentText', 'background'],
    ['accentText', 'surface'],
    ['onPrimary', 'primary'],
    ['onAccent', 'accent'],
    ['text', 'highlight'],
    ['text', 'selectedTint'],
    ['text', 'panel'],
  ] as const)('text %s on %s has AA contrast (4.5:1)', (foreground, background) => {
    expect(
      contrast(candlelightPalette[foreground], candlelightPalette[background]),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('the gold border of chips and rings is visible on the background (3:1)', () => {
    expect(
      contrast(candlelightPalette.hairlineGold, candlelightPalette.background),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(candlelightPalette.hairlineGold, candlelightPalette.surface),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('danger colour (delete and other destructive actions), both themes', () => {
  it.each([
    ['paper', paperPalette],
    ['black and gold', candlelightPalette],
  ] as const)('%s: readable on the background and on cards (4.5:1)', (_name, palette) => {
    expect(contrast(palette.danger, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.danger, palette.surface)).toBeGreaterThanOrEqual(4.5);
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
