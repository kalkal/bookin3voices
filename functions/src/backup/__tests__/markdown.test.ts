// Unit test della composizione Markdown del backup: frontmatter,
// fedeltà del corpo al rawText (accenti, virgolette, newline), indice del
// libro e nomi di file/cartelle deterministici e senza collisioni.

import {
  backupZipFileName,
  bookFolderName,
  bookIndexMarkdown,
  chapterFileName,
  chapterMarkdown,
  yamlText,
} from '../markdown';
import type { BookForBackup } from '../types';

const GENERATED_AT = new Date('2026-09-06T10:00:00.000Z');

function libro(overrides: Partial<BookForBackup> = {}): BookForBackup {
  return {
    title: 'Il faro di Levante',
    author: 'Jane Doe',
    description: 'Nora eredita un faro e il segreto che custodiva.',
    language: 'it',
    genre: 'romanzo',
    chapters: [
      { order: 0, title: 'Il ritorno', status: 'draft', wordCount: 30, rawText: 'Testo uno.' },
      { order: 1, title: 'Il registro', status: 'refined', wordCount: 12, rawText: 'Testo due.' },
    ],
    ...overrides,
  };
}

describe('yamlText', () => {
  it('scappa doppi apici e backslash, appiattisce i newline', () => {
    expect(yamlText('Un "titolo" con \\ dentro')).toBe('"Un \\"titolo\\" con \\\\ dentro"');
    expect(yamlText('riga uno\nriga due')).toBe('"riga uno riga due"');
  });
});

describe('chapterMarkdown', () => {
  it('frontmatter con titolo/ordine/stato/parole e corpo fedele', () => {
    const rawText = 'Diciassette anni: «un’eternità», avrebbe detto lo zio.\nE poi — daccapo.';
    const md = chapterMarkdown(3, {
      order: 2,
      title: 'L’attesa',
      status: 'draft',
      wordCount: 11,
      rawText,
    });
    expect(md).toBe(
      [
        '---',
        'titolo: "L’attesa"',
        'ordine: 3',
        'stato: "draft"',
        'parole: 11',
        '---',
        '',
        `${rawText}\n`,
      ].join('\n'),
    );
  });

  it('un capitolo vuoto produce corpo vuoto, mai testo inventato', () => {
    const md = chapterMarkdown(1, {
      order: 0,
      title: 'Vuoto',
      status: 'draft',
      wordCount: 0,
      rawText: '',
    });
    expect(md.endsWith('---\n\n\n')).toBe(true);
  });
});

describe('chapterFileName', () => {
  it('prefisso numerico in ordine di lettura + slug del titolo', () => {
    expect(chapterFileName(1, 12, 'Il ritorno')).toBe('01-il-ritorno.md');
    expect(chapterFileName(12, 12, 'È già sera')).toBe('12-e-gia-sera.md');
  });

  it('padding adeguato oltre i 99 capitoli e ripiego per titoli vuoti', () => {
    expect(chapterFileName(7, 120, '???')).toBe('007-capitolo.md');
  });

  it('titoli uguali non collidono: il prefisso li distingue', () => {
    expect(chapterFileName(1, 2, 'Notte')).not.toBe(chapterFileName(2, 2, 'Notte'));
  });
});

describe('bookIndexMarkdown', () => {
  it('elenca metadati e capitoli con link, stato e parole', () => {
    const book = libro();
    const md = bookIndexMarkdown(book, ['01-il-ritorno.md', '02-il-registro.md'], GENERATED_AT);
    expect(md).toContain('# Il faro di Levante');
    expect(md).toContain('- Autore: Jane Doe');
    expect(md).toContain('- Capitoli: 2');
    expect(md).toContain('- Parole (dettate): 42');
    expect(md).toContain('- Backup del: 2026-09-06');
    expect(md).toContain('Nora eredita un faro e il segreto che custodiva.');
    expect(md).toContain('1. [Il ritorno](01-il-ritorno.md) — draft, 30 parole');
    expect(md).toContain('2. [Il registro](02-il-registro.md) — refined, 12 parole');
  });

  it('un libro senza capitoli resta leggibile', () => {
    const md = bookIndexMarkdown(libro({ chapters: [] }), [], GENERATED_AT);
    expect(md).toContain('- Capitoli: 0');
    expect(md).toContain('_Nessun capitolo ancora._');
  });
});

describe('bookFolderName', () => {
  it('slug del titolo, con suffissi progressivi sulle collisioni', () => {
    const used = new Set<string>();
    expect(bookFolderName('Il faro di Levante', used)).toBe('il-faro-di-levante');
    expect(bookFolderName('Il faro di Levante', used)).toBe('il-faro-di-levante-2');
    expect(bookFolderName('???', used)).toBe('libro');
    expect(bookFolderName('', used)).toBe('libro-2');
  });
});

describe('backupZipFileName', () => {
  it('biblioteca intera vs libro singolo, con la data del backup', () => {
    expect(backupZipFileName(null, GENERATED_AT)).toBe('backup-bookvoice-2026-09-06.zip');
    expect(backupZipFileName('Il faro di Levante', GENERATED_AT)).toBe(
      'backup-il-faro-di-levante-2026-09-06.zip',
    );
    expect(backupZipFileName('', GENERATED_AT)).toBe('backup-libro-2026-09-06.zip');
  });
});
