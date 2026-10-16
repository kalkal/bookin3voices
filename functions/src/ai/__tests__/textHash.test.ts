// Vettori di riferimento IDENTICI a quelli dell'app
// (app/src/features/review/__tests__/textHash.test.ts): se uno dei due test
// cambia, cambia il contratto condiviso e vanno aggiornati insieme.

import { textHash } from '../textHash';

describe('textHash (gemello del contratto)', () => {
  it('valori noti FNV-1a 64 (gli stessi dell’app)', () => {
    expect(textHash('')).toBe('v1-cbf29ce484222325');
    expect(textHash('a')).toBe('v1-af63dc4c8601ec8c');
  });

  it('deterministico, versionato, sensibile a ogni carattere', () => {
    expect(textHash('Il colpo si ripeté.')).toBe(textHash('Il colpo si ripeté.'));
    expect(textHash('Il colpo si ripeté.')).not.toBe(textHash('Il colpo si ripete.'));
    expect(textHash('perché')).toMatch(/^v1-[0-9a-f]{16}$/);
  });
});
