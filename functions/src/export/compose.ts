// Composizione del libro per l'export: frontespizio, indice e
// capitoli in ordine. Funzioni pure, condivise dagli exporter: qui si decide
// COSA finisce nel file, ogni exporter decide solo COME renderlo.

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

/** Numerali romani come nell'app (firma visiva dei capitoli). */
export function toRoman(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) {
    throw new RangeError(`toRoman accetta interi tra 1 e 3999, ricevuto: ${value}`);
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

/** Capitolo composto: titolo da mostrare + paragrafi di testo puro. */
export interface ComposedChapter {
  displayTitle: string;
  paragraphs: string[];
}

/**
 * Titolo del capitolo nel libro esportato: "Capitolo <romano> — <titolo>"
 * (numerali romani come nell'app). `position` è 1-based.
 */
export function chapterDisplayTitle(position: number, title: string): string {
  const base = `Capitolo ${toRoman(position)}`;
  const trimmed = title.trim();
  return trimmed === '' ? base : `${base} — ${trimmed}`;
}

/**
 * Il rawText della dettatura usa i newline come confini («a capo», «nuovo
 * paragrafo»): ogni sequenza di newline apre un paragrafo nuovo. Un capitolo
 * ancora vuoto produce zero paragrafi (compare nel libro col solo titolo).
 */
export function splitParagraphs(rawText: string): string[] {
  return rawText
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
}

/** Capitoli composti in ordine di lettura (l'ordine è già quello di `order`). */
export function composeChapters(book: BookForExport): ComposedChapter[] {
  return book.chapters.map((chapter, index) => ({
    displayTitle: chapterDisplayTitle(index + 1, chapter.title),
    paragraphs: splitParagraphs(chapter.rawText),
  }));
}

/** Escape HTML per i contenuti EPUB (il testo dettato è testo puro, mai HTML). */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Slug ASCII di un titolo (nomi file/cartelle degli export e del backup):
 * gli accenti si riducono alla lettera base; tutto il resto diventa trattino.
 * Un titolo senza caratteri utilizzabili produce stringa vuota: il chiamante
 * decide il ripiego.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Nome file dell'export: slug ASCII del titolo + estensione. */
export function exportFileName(title: string, extension: string): string {
  const slug = slugify(title);
  return `${slug === '' ? 'libro' : slug}.${extension}`;
}

/** Lingua per i metadati KDP: mai vuota (default 'it', assunzione dichiarata). */
export function exportLanguage(language: string): string {
  const trimmed = language.trim();
  return trimmed === '' ? 'it' : trimmed;
}
