import { appendText, countWords } from '../text';

describe('countWords', () => {
  it('counts words separated by spaces', () => {
    expect(countWords('la porta era chiusa')).toBe(4);
  });

  it('ignores multiple spaces, newlines and edges', () => {
    expect(countWords('  la  porta\nera   chiusa  ')).toBe(4);
  });

  it('returns 0 for empty or whitespace-only text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
  });
});

describe('appendText', () => {
  it('joins two blocks with a space', () => {
    expect(appendText('prima frase.', 'Seconda frase')).toBe('prima frase. Seconda frase');
  });

  it('does not double the separation if the base text ends with a space or newline', () => {
    expect(appendText('paragrafo.\n\n', 'Nuovo paragrafo')).toBe('paragrafo.\n\nNuovo paragrafo');
    expect(appendText('parola ', 'dopo')).toBe('parola dopo');
  });

  it('handles empty edges without stray spaces', () => {
    expect(appendText('', 'solo aggiunta')).toBe('solo aggiunta');
    expect(appendText('solo base', '')).toBe('solo base');
    expect(appendText('', '')).toBe('');
  });
});
