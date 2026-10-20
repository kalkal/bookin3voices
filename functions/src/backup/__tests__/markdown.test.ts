// Unit tests of the backup Markdown composition: frontmatter, body fidelity to
// rawText (accents, quotes, newlines), book index, and deterministic
// collision-free file/folder names.

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
    title: 'Il mulino di Rocca Bassa',
    author: 'Jane Doe',
    description: 'Viola rileva le arnie di un mulino e il segreto che custodivano.',
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
  it('escapes double quotes and backslashes, flattens newlines', () => {
    expect(yamlText('Un "titolo" con \\ dentro')).toBe('"Un \\"titolo\\" con \\\\ dentro"');
    expect(yamlText('riga uno\nriga due')).toBe('"riga uno riga due"');
  });
});

describe('chapterMarkdown', () => {
  it('frontmatter with title/order/status/word count and faithful body', () => {
    const rawText = 'Diciassette anni: «un’eternità», avrebbe detto Olga.\nE poi — daccapo.';
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

  it('an empty chapter produces an empty body, never invented text', () => {
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
  it('numeric prefix in reading order + title slug', () => {
    expect(chapterFileName(1, 12, 'Il ritorno')).toBe('01-il-ritorno.md');
    expect(chapterFileName(12, 12, 'È già sera')).toBe('12-e-gia-sera.md');
  });

  it('adequate padding beyond 99 chapters and fallback for empty titles', () => {
    expect(chapterFileName(7, 120, '???')).toBe('007-capitolo.md');
  });

  it('identical titles do not collide: the prefix tells them apart', () => {
    expect(chapterFileName(1, 2, 'Notte')).not.toBe(chapterFileName(2, 2, 'Notte'));
  });
});

describe('bookIndexMarkdown', () => {
  it('lists metadata and chapters with link, status and word count', () => {
    const book = libro();
    const md = bookIndexMarkdown(book, ['01-il-ritorno.md', '02-il-registro.md'], GENERATED_AT);
    expect(md).toContain('# Il mulino di Rocca Bassa');
    expect(md).toContain('- Autore: Jane Doe');
    expect(md).toContain('- Capitoli: 2');
    expect(md).toContain('- Parole (dettate): 42');
    expect(md).toContain('- Backup del: 2026-09-06');
    expect(md).toContain('Viola rileva le arnie di un mulino e il segreto che custodivano.');
    expect(md).toContain('1. [Il ritorno](01-il-ritorno.md) — draft, 30 parole');
    expect(md).toContain('2. [Il registro](02-il-registro.md) — refined, 12 parole');
  });

  it('a book without chapters stays readable', () => {
    const md = bookIndexMarkdown(libro({ chapters: [] }), [], GENERATED_AT);
    expect(md).toContain('- Capitoli: 0');
    expect(md).toContain('_Nessun capitolo ancora._');
  });
});

describe('bookFolderName', () => {
  it('title slug, with progressive suffixes on collisions', () => {
    const used = new Set<string>();
    expect(bookFolderName('Il mulino di Rocca Bassa', used)).toBe('il-mulino-di-rocca-bassa');
    expect(bookFolderName('Il mulino di Rocca Bassa', used)).toBe('il-mulino-di-rocca-bassa-2');
    expect(bookFolderName('???', used)).toBe('libro');
    expect(bookFolderName('', used)).toBe('libro-2');
  });
});

describe('backupZipFileName', () => {
  it('whole library vs single book, with the backup date', () => {
    expect(backupZipFileName(null, GENERATED_AT)).toBe('backup-bookvoice-2026-09-06.zip');
    expect(backupZipFileName('Il mulino di Rocca Bassa', GENERATED_AT)).toBe(
      'backup-il-mulino-di-rocca-bassa-2026-09-06.zip',
    );
    expect(backupZipFileName('', GENERATED_AT)).toBe('backup-libro-2026-09-06.zip');
  });
});
