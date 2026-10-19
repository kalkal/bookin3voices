// WCAG 2.x helpers shared by the tests that pin readability (not used by the app).

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** Contrast ratio between two #RRGGBB colours (4.5 for text, 3 for controls). */
export function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = channels(hex).map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** `top` drawn over `bottom` at `alpha` (0..1), as #RRGGBB. */
export function blend(top: string, bottom: string, alpha: number): string {
  const [t, b] = [channels(top), channels(bottom)];
  const mixed = t.map((value, i) => Math.round(value * alpha + (b[i] ?? 0) * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
