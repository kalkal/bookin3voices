// The language of a dictation: ONE place that turns the book language (a free
// text field, see ExportTab) into the BCP-47 locale for the speech recognizer
// and into the language of the spoken commands. The interface language is only
// the fallback when the book has no usable language.

import { getLanguage } from '../../i18n';

/** Languages with spoken commands (voiceCommands.ts). */
export type CommandLanguage = 'it' | 'en';

const DEFAULT_REGION: Record<CommandLanguage, string> = { it: 'IT', en: 'US' };

/** Names people type in the free-text language field. */
const ALIASES: Record<string, CommandLanguage> = {
  it: 'it',
  ita: 'it',
  italiano: 'it',
  italian: 'it',
  en: 'en',
  eng: 'en',
  english: 'en',
  inglese: 'en',
};

/**
 * Recognition locale for a book language ("it" → "it-IT", "en-GB" stays,
 * "Italian" → "it-IT"). Empty or unsupported → the interface language.
 */
export function dictationLocale(bookLanguage?: string): string {
  const [first = '', second = ''] = (bookLanguage ?? '').trim().split(/[\s_-]+/);
  const language = ALIASES[first.toLowerCase()] ?? getLanguage();
  const known = ALIASES[first.toLowerCase()] !== undefined;
  const region = known && /^[A-Za-z]{2}$/.test(second) ? second.toUpperCase() : undefined;
  // "UK" is how people write it; the BCP-47 region is GB
  return `${language}-${(region === 'UK' ? 'GB' : region) ?? DEFAULT_REGION[language]}`;
}

/** Spoken-command language of a locale such as "en-US". */
export function commandLanguage(locale: string): CommandLanguage {
  return locale.toLowerCase().startsWith('it') ? 'it' : 'en';
}
