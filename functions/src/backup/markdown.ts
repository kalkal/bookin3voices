// Composizione del backup Markdown: funzioni pure, qui si
// decide COSA finisce in ogni file. Un file per capitolo (frontmatter YAML +
// rawText FEDELE, mai rielaborato) e un indice per libro. Lo zip lo assembla
// exportBackup.ts.

import { slugify } from '../export/compose';
import type { BookForBackup, ChapterForBackup } from './types';

/**
 * Scalare YAML tra doppi apici: il titolo è testo libero (può contenere
 * apici, due punti, «virgolette»), quindi si scappano solo backslash e
 * doppio apice; eventuali newline diventano spazi (un titolo resta una riga).
 */
export function yamlText(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s*\n\s*/g, ' ');
  return `"${escaped}"`;
}

/** "01", "02", … "117": ordinamento alfabetico = ordine di lettura. */
function pad(position: number, width: number): string {
  return String(position).padStart(width, '0');
}

/**
 * Nome file del capitolo: `NN-slug.md`. `position` è 1-based (l'ordine di
 * lettura, come i numerali romani in app); il prefisso numerico rende i nomi
 * unici anche con titoli uguali o vuoti. `total` decide lo zero-padding.
 */
export function chapterFileName(position: number, total: number, title: string): string {
  const width = Math.max(2, String(total).length);
  const slug = slugify(title);
  return `${pad(position, width)}-${slug === '' ? 'capitolo' : slug}.md`;
}

/**
 * File Markdown di un capitolo: frontmatter con titolo/ordine/stato/parole e
 * corpo = rawText VERBATIM (fedeltà al testo grezzo: niente trim, niente
 * riformattazioni — è la via d'uscita dei dati).
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

/** Data leggibile nell'indice (UTC: deterministica, niente fuso del server). */
function isoDate(generatedAt: Date): string {
  return generatedAt.toISOString().slice(0, 10);
}

/**
 * Indice del libro (indice.md): metadati e sommario dei capitoli con link ai
 * file. `fileNames` è allineato a `book.chapters` (stesso ordine).
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
 * Cartella del libro nello zip: slug del titolo, con suffisso progressivo se
 * due libri producono lo stesso slug (titoli uguali o entrambi non-ASCII).
 * `used` è mutato: passare lo stesso Set per tutti i libri di un backup.
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
 * Nome dello zip: con un solo libro richiesto porta lo slug del titolo,
 * altrimenti è il backup dell'intera biblioteca. La data rende riconoscibile
 * il file tra più backup successivi.
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
