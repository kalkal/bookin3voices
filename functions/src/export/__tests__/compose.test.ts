// Unit tests of the composition: titles, paragraphs, escaping, file name and
// default language. Pure logic.

import {
  chapterDisplayTitle,
  composeChapters,
  escapeHtml,
  exportFileName,
  exportLabels,
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
    expect(chapterDisplayTitle(1, 'Il ritorno', 'it')).toBe('Capitolo I — Il ritorno');
    expect(chapterDisplayTitle(12, ' Il registro ', 'it')).toBe('Capitolo XII — Il registro');
  });

  it('without a title stays "Capitolo <roman>"', () => {
    expect(chapterDisplayTitle(3, '', 'it')).toBe('Capitolo III');
    expect(chapterDisplayTitle(3, '   ', 'it')).toBe('Capitolo III');
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
    expect(exportFileName('Il mulino di Rocca Bassa', 'epub')).toBe(
      'il-mulino-di-rocca-bassa.epub',
    );
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

describe('exportLabels', () => {
  it('gives the fixed texts of the book in the book language', () => {
    expect(exportLabels('it')).toEqual({ chapter: 'Capitolo', contents: 'Indice' });
    expect(exportLabels('en')).toEqual({ chapter: 'Chapter', contents: 'Contents' });
  });

  it('accepts regional tags and any letter case', () => {
    expect(exportLabels('en-US').chapter).toBe('Chapter');
    expect(exportLabels('EN_gb').contents).toBe('Contents');
    expect(exportLabels(' it-IT ').chapter).toBe('Capitolo');
  });

  it('an empty language follows the export default (it)', () => {
    expect(exportLabels('  ')).toEqual(exportLabels('it'));
  });

  it('an unsupported language falls back to English, never to Italian', () => {
    expect(exportLabels('fr')).toEqual(exportLabels('en'));
  });
});

describe('chapter titles in English', () => {
  it('composes "Chapter <roman> — <title>"', () => {
    expect(chapterDisplayTitle(2, 'The Dark Light', 'en')).toBe('Chapter II — The Dark Light');
    expect(chapterDisplayTitle(4, '', 'en')).toBe('Chapter IV');
  });

  it('composeChapters follows the book language', () => {
    const book: BookForExport = {
      title: 'Test',
      author: 'A',
      description: '',
      language: 'en',
      genre: '',
      chapters: [{ title: 'One', rawText: 'a' }],
    };
    expect(composeChapters(book)[0]?.displayTitle).toBe('Chapter I — One');
  });
});

describe('exportLabels with the free-text language field', () => {
  it.each(['Italiano', 'italian', 'ITA', ' it '])('%j is Italian', (language) => {
    expect(exportLabels(language).chapter).toBe('Capitolo');
  });

  it.each(['English', 'eng', 'Inglese'])('%j is English', (language) => {
    expect(exportLabels(language).chapter).toBe('Chapter');
  });
});
