import { uiLocale } from '../i18n';

/**
 * Pure text utilities, shared across features.
 * Pure logic = preferred target for unit tests.
 */

/** Counts the words in a text (multiple spaces and newlines included). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

/**
 * Number in the Italian format of the mockup ("24.310"). If Intl is not
 * available, falls back to plain digits: better bare than broken.
 */
export function formatNumber(value: number): string {
  try {
    return new Intl.NumberFormat(uiLocale()).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Appends a block of text to an existing one, separating them with a space,
 * without doubling spaces or newlines already present at the join.
 */
export function appendText(base: string, addition: string): string {
  if (addition === '') return base;
  if (base === '') return addition;
  const separator = /\s$/.test(base) ? '' : ' ';
  return base + separator + addition;
}
