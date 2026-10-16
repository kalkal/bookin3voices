import { textHash } from '../textHash';

describe('textHash (contratto condiviso con la function refineChapter)', () => {
  it('è deterministico e versionato', () => {
    expect(textHash('Il colpo si ripeté.')).toBe(textHash('Il colpo si ripeté.'));
    expect(textHash('')).toMatch(/^v1-[0-9a-f]{16}$/);
  });

  it('cambia se il testo cambia anche di un solo carattere', () => {
    expect(textHash('Il colpo si ripeté.')).not.toBe(textHash('Il colpo si ripete.'));
  });

  it('valori noti FNV-1a 64 (da rieseguire identici lato Functions)', () => {
    // vettori di riferimento: se questo test cambia, cambia il contratto con la callable refineChapter
    expect(textHash('')).toBe('v1-cbf29ce484222325');
    expect(textHash('a')).toBe('v1-af63dc4c8601ec8c');
    expect(textHash('perché')).toBe(textHash('perché'));
  });
});
