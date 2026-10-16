// UI strings in English (default) and Italian. The language follows the device locale
// at startup: Italian devices get Italian, every other device gets English. Unit tests run
// in Italian (see jest.setup.ts) so that their assertions stay readable for the existing
// suites; the English dictionary is checked key-by-key against the Italian one.
//
// Each feature owns one namespace file in this folder (`books.ts`, `review.ts`, ...)
// exporting `{ en, it }` with the same keys, prefixed by the namespace name.

import { books } from './books';
import { chapters } from './chapters';
import { common } from './common';
import { dictation } from './dictation';
import { exportStrings } from './export';
import { notes } from './notes';
import { outline } from './outline';
import { review } from './review';
import { settings } from './settings';

export type Lang = 'en' | 'it';
export type Dictionary = Record<string, string>;
export interface Namespace {
  en: Dictionary;
  it: Dictionary;
}

export const NAMESPACES: Record<string, Namespace> = {
  books,
  chapters,
  common,
  dictation,
  export: exportStrings,
  notes,
  outline,
  review,
  settings,
};

function merge(lang: Lang): Dictionary {
  return Object.assign({}, ...Object.values(NAMESPACES).map((ns) => ns[lang]));
}

const DICTIONARIES: Record<Lang, Dictionary> = { en: merge('en'), it: merge('it') };

export function detectLanguage(): Lang {
  // optional override for demos and screenshots, e.g. EXPO_PUBLIC_UI_LANG=en
  const forced = process.env.EXPO_PUBLIC_UI_LANG;
  if (forced === 'en' || forced === 'it') return forced;
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    return locale.startsWith('it') ? 'it' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = detectLanguage();

export function getLanguage(): Lang {
  return current;
}

/** Changes the UI language (used by tests; the app picks it once at startup). */
export function setLanguage(lang: Lang): void {
  current = lang;
}

/** BCP-47 locale for number and date formatting in the current UI language. */
export function uiLocale(): string {
  return current === 'it' ? 'it-IT' : 'en-US';
}

type Params = Record<string, string | number>;

function fill(template: string, params?: Params): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Translated string for `key`, with `{name}` placeholders filled from `params`. */
export function t(key: string, params?: Params): string {
  const template = DICTIONARIES[current][key] ?? DICTIONARIES.en[key] ?? key;
  return fill(template, params);
}

/**
 * Plural form: looks up `${key}_one` when `count` is 1 and `${key}_other` otherwise;
 * `{count}` is available in the template.
 */
export function tn(key: string, count: number, params?: Params): string {
  return t(`${key}_${count === 1 ? 'one' : 'other'}`, { count, ...params });
}
