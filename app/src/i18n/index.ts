// UI strings in English (default) and Italian. By default the language follows the device
// locale (Italian devices get Italian, every other device gets English); Settings can force
// one, and setLanguage() switches it at runtime. Unit tests run
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

type Listener = () => void;
const listeners = new Set<Listener>();

/** Notifies `listener` when the UI language changes; returns the unsubscribe function. */
export function subscribeLanguage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Changes the UI language and notifies the subscribers (the app re-renders). */
export function setLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  listeners.forEach((listener) => listener());
}

/** Interface language preference saved in Settings. */
export type LanguagePreference = 'system' | Lang;

/** Concrete language for a preference: 'system' follows the device. */
export function resolveLanguage(preference: LanguagePreference): Lang {
  return preference === 'system' ? detectLanguage() : preference;
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
