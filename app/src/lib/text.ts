import { uiLocale } from '../i18n';

/**
 * Utility pure sul testo, condivise tra le feature.
 * Logica pura = target preferito degli unit test.
 */

/** Conta le parole di un testo (spazi e a capo multipli inclusi). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

/**
 * Numero nel formato italiano del mockup ("24.310"). Se Intl non è disponibile
 * si torna alle cifre semplici: meglio spoglio che rotto.
 */
export function formatNumber(value: number): string {
  try {
    return new Intl.NumberFormat(uiLocale()).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Accoda un blocco di testo a uno esistente separandoli con uno spazio,
 * senza raddoppiare spazi o a capo già presenti alla giunzione.
 */
export function appendText(base: string, addition: string): string {
  if (addition === '') return base;
  if (base === '') return addition;
  const separator = /\s$/.test(base) ? '' : ' ';
  return base + separator + addition;
}
