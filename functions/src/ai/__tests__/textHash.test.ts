// Reference vectors IDENTICAL to the app's
// (app/src/features/review/__tests__/textHash.test.ts): if either test
// changes, the shared contract changes and both must be updated together.

import { textHash } from '../textHash';

describe('textHash (twin of the shared contract)', () => {
  it("known FNV-1a 64 values (the same as the app's)", () => {
    expect(textHash('')).toBe('v1-cbf29ce484222325');
    expect(textHash('a')).toBe('v1-af63dc4c8601ec8c');
  });

  it('deterministic, versioned, sensitive to every character', () => {
    expect(textHash('Il colpo si ripeté.')).toBe(textHash('Il colpo si ripeté.'));
    expect(textHash('Il colpo si ripeté.')).not.toBe(textHash('Il colpo si ripete.'));
    expect(textHash('perché')).toMatch(/^v1-[0-9a-f]{16}$/);
  });
});
