/**
 * Roman numerals — the visual signature of chapters.
 */

const ROMAN_STEPS: readonly (readonly [number, string])[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** Converts an integer 1–3999 to a Roman numeral. */
export function toRoman(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) {
    throw new RangeError(`toRoman accepts integers between 1 and 3999, received: ${value}`);
  }
  let rest = value;
  let out = '';
  for (const [step, glyph] of ROMAN_STEPS) {
    while (rest >= step) {
      out += glyph;
      rest -= step;
    }
  }
  return out;
}
