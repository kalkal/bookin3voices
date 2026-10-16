// Unit tests of the composition: titles, paragraphs, escaping, file name and
// default language. Pure logic.

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
  it('converts as in the app (the visual signature of chapters)', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(28)).toBe('XXVIII');
  });

  it('rejects out-of-range values', () => {
    expect(() => toRoman(0)).toThrow(RangeError);
    expect(() => toRoman(1.5)).toThrow(RangeError);
  });
});

describe('chapterDisplayTitle', () => {
  it('composes "Capitolo <roman> — <title>"', () => {
    expect(chapterDisplayTitle(1, 'Il ritorno')).toBe('Capitolo I — Il ritorno');
    expect(chapterDisplayTitle(12, ' Il registro ')).toBe('Capitolo XII — Il registro');
  });

  it('without a title stays "Capitolo <roman>"', () => {
    expect(chapterDisplayTitle(3, '')).toBe('Capitolo III');
    expect(chapterDisplayTitle(3, '   ')).toBe('Capitolo III');
  });
});

describe('splitParagraphs', () => {
  it('each run of newlines opens a new paragraph', () => {
    expect(splitParagraphs('Primo.\nSecondo.\n\nTerzo.')).toEqual(['Primo.', 'Secondo.', 'Terzo.']);
  });

  it('ignores blank lines and surrounding spaces', () => {
    expect(splitParagraphs('  Solo uno.  \n\n   \n')).toEqual(['Solo uno.']);
  });

  it('empty chapter -> zero paragraphs', () => {
    expect(splitParagraphs('')).toEqual([]);
  });
});

describe('composeChapters', () => {
  it('numbers in order and composes paragraphs', () => {
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
  it('neutralizes HTML metacharacters', () => {
    expect(escapeHtml(`Tom & Jerry <b> "ciao" 'l'una'`)).toBe(
      'Tom &amp; Jerry &lt;b&gt; &quot;ciao&quot; &#39;l&#39;una&#39;',
    );
  });
});

describe('exportFileName', () => {
  it('ASCII title slug with accents reduced to the base letter', () => {
    expect(exportFileName('Il faro di Levante', 'epub')).toBe('il-faro-di-levante.epub');
    expect(exportFileName('Perché no? È così!', 'docx')).toBe('perche-no-e-cosi.docx');
  });

  it('title with no usable characters -> "libro"', () => {
    expect(exportFileName('!!!', 'epub')).toBe('libro.epub');
  });
});

describe('exportLanguage', () => {
  it('uses the book language, defaulting to it when empty', () => {
    expect(exportLanguage('en')).toBe('en');
    expect(exportLanguage('  ')).toBe('it');
  });
});
