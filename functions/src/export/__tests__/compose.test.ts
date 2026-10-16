// Unit test della composizione: titoli, paragrafi, escape,
// nome file e lingua di default. Logica pura: TDD obbligatorio.

import {
  chapterDisplayTitle,
  composeChapters,
  escapeHtml,
  exportFileName,
  exportLanguage,
  splitParagraphs,
  toRoman,
} from '../compose';
import type { BookForExport } from '../types';

describe('toRoman', () => {
  it('converte come nella app (firma visiva dei capitoli)', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(28)).toBe('XXVIII');
  });

  it('rifiuta valori fuori range', () => {
    expect(() => toRoman(0)).toThrow(RangeError);
    expect(() => toRoman(1.5)).toThrow(RangeError);
  });
});

describe('chapterDisplayTitle', () => {
  it('compone "Capitolo <romano> — <titolo>"', () => {
    expect(chapterDisplayTitle(1, 'Il ritorno')).toBe('Capitolo I — Il ritorno');
    expect(chapterDisplayTitle(12, ' Il registro ')).toBe('Capitolo XII — Il registro');
  });

  it('senza titolo resta "Capitolo <romano>"', () => {
    expect(chapterDisplayTitle(3, '')).toBe('Capitolo III');
    expect(chapterDisplayTitle(3, '   ')).toBe('Capitolo III');
  });
});

describe('splitParagraphs', () => {
  it('ogni sequenza di newline apre un paragrafo nuovo', () => {
    expect(splitParagraphs('Primo.\nSecondo.\n\nTerzo.')).toEqual(['Primo.', 'Secondo.', 'Terzo.']);
  });

  it('ignora righe vuote e spazi ai bordi', () => {
    expect(splitParagraphs('  Solo uno.  \n\n   \n')).toEqual(['Solo uno.']);
  });

  it('capitolo vuoto → zero paragrafi', () => {
    expect(splitParagraphs('')).toEqual([]);
  });
});

describe('composeChapters', () => {
  it('numera in ordine e compone i paragrafi', () => {
    const book: BookForExport = {
      title: 'Prova',
      author: 'A',
      description: '',
      language: 'it',
      genre: '',
      chapters: [
        { title: 'Uno', rawText: 'a\nb' },
        { title: '', rawText: '' },
      ],
    };
    expect(composeChapters(book)).toEqual([
      { displayTitle: 'Capitolo I — Uno', paragraphs: ['a', 'b'] },
      { displayTitle: 'Capitolo II', paragraphs: [] },
    ]);
  });
});

describe('escapeHtml', () => {
  it('neutralizza i metacaratteri HTML', () => {
    expect(escapeHtml(`Tom & Jerry <b> "ciao" 'l'una'`)).toBe(
      'Tom &amp; Jerry &lt;b&gt; &quot;ciao&quot; &#39;l&#39;una&#39;',
    );
  });
});

describe('exportFileName', () => {
  it('slug ASCII del titolo con accenti ridotti alla base', () => {
    expect(exportFileName('Il faro di Levante', 'epub')).toBe('il-faro-di-levante.epub');
    expect(exportFileName('Perché no? È così!', 'docx')).toBe('perche-no-e-cosi.docx');
  });

  it('titolo senza caratteri utili → "libro"', () => {
    expect(exportFileName('!!!', 'epub')).toBe('libro.epub');
  });
});

describe('exportLanguage', () => {
  it('usa la lingua del libro, con default it se vuota', () => {
    expect(exportLanguage('en')).toBe('en');
    expect(exportLanguage('  ')).toBe('it');
  });
});
