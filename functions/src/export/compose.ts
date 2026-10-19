// Book composition for export: title page, index and chapters in order. Pure
// functions shared by the exporters: this decides WHAT goes into the file,
// each exporter decides only HOW to render it.

import type { BookForExport } from './types';

const ROMAN_STEPS: readonly (readonly [number, string])[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** Roman numerals as in the app (the visual signature of chapters). */
export function toRoman(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) {
    throw new RangeError(`toRoman accepts integers between 1 and 3999, received: ${value}`);
  }
  let rest = value;
  let out = '';
  for (const [step, glyph] of ROMAN_STEPS) {
    while (rest >= step) {
      out += glyph;
      rest -= step;
    }
  }
  return out;
}

/** Composed chapter: display title + plain-text paragraphs. */
export interface ComposedChapter {
  displayTitle: string;
  paragraphs: string[];
}

/** Fixed texts the export adds to the book itself (not the author's words). */
export interface ExportLabels {
  /** Word before the chapter number: "Capitolo I", "Chapter I". */
  chapter: string;
  /** Title of the index / table of contents. */
  contents: string;
}

const EXPORT_LABELS = {
  it: { chapter: 'Capitolo', contents: 'Indice' },
  en: { chapter: 'Chapter', contents: 'Contents' },
} as const satisfies Record<string, ExportLabels>;

const ITALIAN_NAMES: ReadonlySet<string> = new Set(['it', 'ita', 'italiano', 'italian']);

/**
 * Fixed texts of the exported book in the book language: the ONE place where
 * they live (exporters and chapter titles read them from here). Regional tags
 * and letter case are ignored ("en-US", "EN_gb"); the language field of the
 * app is free text, so the Italian names people type ("Italiano", "ita",
 * "Italian") count as Italian too, as before this was language-aware. An empty
 * language follows the export default; a language without a translation falls
 * back to English, so a French book never gets Italian words.
 */
export function exportLabels(language: string): ExportLabels {
  const primary = exportLanguage(language).toLowerCase().split(/[-_]/)[0] ?? '';
  return ITALIAN_NAMES.has(primary) ? EXPORT_LABELS.it : EXPORT_LABELS.en;
}

/**
 * Chapter title in the exported book: "<chapter word> <roman> — <title>" (Roman
 * numerals as in the app), in the book language. `position` is 1-based.
 */
export function chapterDisplayTitle(position: number, title: string, language: string): string {
  const base = `${exportLabels(language).chapter} ${toRoman(position)}`;
  const trimmed = title.trim();
  return trimmed === '' ? base : `${base} — ${trimmed}`;
}

/**
 * The dictation rawText uses newlines as boundaries («new line», «new
 * paragraph»): each run of newlines opens a new paragraph. A still-empty
 * chapter produces zero paragraphs (it appears in the book with its title
 * only).
 */
export function splitParagraphs(rawText: string): string[] {
  return rawText
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

/** Composed chapters in reading order (the order is already that of `order`). */
export function composeChapters(book: BookForExport): ComposedChapter[] {
  return book.chapters.map((chapter, index) => ({
    displayTitle: chapterDisplayTitle(index + 1, chapter.title, book.language),
    paragraphs: splitParagraphs(chapter.rawText),
  }));
}

/** HTML escape for EPUB content (dictated text is plain text, never HTML). */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * ASCII slug of a title (file/folder names of exports and backups): accents
 * are reduced to the base letter; everything else becomes a hyphen. A title
 * with no usable characters produces an empty string: the caller decides the
 * fallback.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Export file name: ASCII title slug + extension. */
export function exportFileName(title: string, extension: string): string {
  const slug = slugify(title);
  return `${slug === '' ? 'libro' : slug}.${extension}`;
}

/** Language for KDP metadata: never empty (default 'it', a declared assumption). */
export function exportLanguage(language: string): string {
  const trimmed = language.trim();
  return trimmed === '' ? 'it' : trimmed;
}
