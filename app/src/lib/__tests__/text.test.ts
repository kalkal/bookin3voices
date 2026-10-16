import { appendText, countWords } from '../text';

describe('countWords', () => {
  it('conta le parole separate da spazi', () => {
    expect(countWords('la porta era chiusa')).toBe(4);
  });

  it('ignora spazi multipli, a capo e bordi', () => {
    expect(countWords('  la  porta\nera   chiusa  ')).toBe(4);
  });

  it('restituisce 0 per testo vuoto o solo spazi', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
  });
});

describe('appendText', () => {
  it('unisce due blocchi con uno spazio', () => {
    expect(appendText('prima frase.', 'Seconda frase')).toBe('prima frase. Seconda frase');
  });

  it('non raddoppia la separazione se il testo base finisce con spazio o a capo', () => {
    expect(appendText('paragrafo.\n\n', 'Nuovo paragrafo')).toBe('paragrafo.\n\nNuovo paragrafo');
    expect(appendText('parola ', 'dopo')).toBe('parola dopo');
  });

  it('gestisce i bordi vuoti senza spazi vaganti', () => {
    expect(appendText('', 'solo aggiunta')).toBe('solo aggiunta');
    expect(appendText('solo base', '')).toBe('solo base');
    expect(appendText('', '')).toBe('');
  });
});
