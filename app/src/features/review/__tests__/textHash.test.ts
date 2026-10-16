import { textHash } from '../textHash';

describe('textHash (contract shared with the refineChapter function)', () => {
  it('is deterministic and versioned', () => {
    expect(textHash('Il colpo si ripeté.')).toBe(textHash('Il colpo si ripeté.'));
    expect(textHash('')).toMatch(/^v1-[0-9a-f]{16}$/);
  });

  it('changes if the text changes by even a single character', () => {
    expect(textHash('Il colpo si ripeté.')).not.toBe(textHash('Il colpo si ripete.'));
  });

  it('known FNV-1a 64 values (to be reproduced identically on the Functions side)', () => {
    // reference vectors: if this test changes, the contract with the refineChapter callable changes
    expect(textHash('')).toBe('v1-cbf29ce484222325');
    expect(textHash('a')).toBe('v1-af63dc4c8601ec8c');
    expect(textHash('perché')).toBe(textHash('perché'));
  });
});
