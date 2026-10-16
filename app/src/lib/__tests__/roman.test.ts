import { toRoman } from '../roman';

describe('toRoman', () => {
  it.each([
    [1, 'I'],
    [4, 'IV'],
    [7, 'VII'],
    [9, 'IX'],
    [14, 'XIV'],
    [40, 'XL'],
    [90, 'XC'],
    [400, 'CD'],
    [1999, 'MCMXCIX'],
    [3999, 'MMMCMXCIX'],
  ])('%i → %s', (value, expected) => {
    expect(toRoman(value)).toBe(expected);
  });

  it.each([0, -1, 4000, 2.5, NaN])('rejects %p', (value) => {
    expect(() => toRoman(value)).toThrow(RangeError);
  });
});
