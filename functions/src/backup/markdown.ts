// Markdown backup composition: pure functions that decide WHAT goes into each
// file. One file per chapter (YAML frontmatter + FAITHFUL rawText, never
// reworked) and one index per book. The zip is assembled by exportBackup.ts.

import { slugify } from '../export/compose';
import type { BookForBackup, ChapterForBackup } from './types';

/**
 * Double-quoted YAML scalar: the title is free text (it may contain quotes,
 * colons, «guillemets»), so only backslash and double quote are escaped; any
 * newlines become spaces (a title stays on one line).
 */
export function yamlText(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s*\n\s*/g, ' ');
  return `"${escaped}"`;
}

/** "01", "02", ... "117": alphabetical order = reading order. */
function pad(position: number, width: number): string {
  return String(position).padStart(width, '0');
}

/**
 * Chapter file name: `NN-slug.md`. `position` is 1-based (the reading order,
 * like the Roman numerals in the app); the numeric prefix keeps names unique
 * even with identical or empty titles. `total` decides the zero-padding.
 */
export function chapterFileName(position: number, total: number, title: string): string {
  const width = Math.max(2, String(total).length);
  const slug = slugify(title);
  return `${pad(position, width)}-${slug === '' ? 'capitolo' : slug}.md`;
}

/**
 * Markdown file of one chapter: frontmatter with title/order/status/word count
 * and body = rawText VERBATIM (faithful to the raw text: no trim, no
 * reformatting - it is the data exit route).
 */
export function chapterMarkdown(position: number, chapter: ChapterForBackup): string {
  const frontmatter = [
    '---',
    `titolo: ${yamlText(chapter.title)}`,
    `ordine: ${position}`,
    `stato: ${yamlText(chapter.status)}`,
    `parole: ${chapter.wordCount}`,
    '---',
  ].join('\n');
  return `${frontmatter}\n\n${chapter.rawText}\n`;
}

/** Readable date for the index (UTC: deterministic, independent of server timezone). */
function isoDate(generatedAt: Date): string {
  return generatedAt.toISOString().slice(0, 10);
}

/**
 * Book index (indice.md): metadata and chapter summary with links to the
 * files. `fileNames` is aligned with `book.chapters` (same order).
 */
export function bookIndexMarkdown(
  book: BookForBackup,
  fileNames: string[],
  generatedAt: Date,
): string {
  const lines: string[] = [
    `# ${book.title.trim() === '' ? 'Libro senza titolo' : book.title.trim()}`,
    '',
    `- Autore: ${book.author}`,
    `- Genere: ${book.genre}`,
    `- Lingua: ${book.language}`,
    `- Capitoli: ${book.chapters.length}`,
    `- Parole (dettate): ${book.chapters.reduce((sum, c) => sum + c.wordCount, 0)}`,
    `- Backup del: ${isoDate(generatedAt)}`,
  ];
  if (book.description.trim() !== '') {
    lines.push('', book.description.trim());
  }
  lines.push('', '## Capitoli', '');
  if (book.chapters.length === 0) {
    lines.push('_Nessun capitolo ancora._');
  }
  book.chapters.forEach((chapter, index) => {
    const label = chapter.title.trim() === '' ? 'Senza titolo' : chapter.title.trim();
    lines.push(
      `${index + 1}. [${label}](${fileNames[index]}) — ${chapter.status}, ${chapter.wordCount} parole`,
    );
  });
  return `${lines.join('\n')}\n`;
}

/**
 * Book folder in the zip: title slug, with a progressive suffix if two books
 * produce the same slug (identical titles or both non-ASCII).
 * `used` is mutated: pass the same Set for all books of a backup.
 */
export function bookFolderName(title: string, used: Set<string>): string {
  const base = slugify(title) === '' ? 'libro' : slugify(title);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Zip name: with a single requested book it carries the title slug, otherwise
 * it is the backup of the whole library. The date makes the file recognizable
 * among successive backups.
 */
export function backupZipFileName(singleBookTitle: string | null, generatedAt: Date): string {
  const scope =
    singleBookTitle === null
      ? 'bookvoice'
      : slugify(singleBookTitle) === ''
        ? 'libro'
        : slugify(singleBookTitle);
  return `backup-${scope}-${isoDate(generatedAt)}.zip`;
}
