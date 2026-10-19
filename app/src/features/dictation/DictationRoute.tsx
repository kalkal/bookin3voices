// Opens the dictation screen in the language of the BOOK being written: the
// language is read once from the book before the screen (and its engine) is
// created, because the recognizer language is fixed for the whole session. A
// book that cannot be read falls back to the interface language
// (dictationLocale), so dictation never stays blocked on this lookup.

import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { BookRepository } from '../books';
import { DictationScreen, type DictationScreenProps } from './DictationScreen';

/** How long the screen waits for the book before using the interface language. */
const BOOK_LOOKUP_TIMEOUT_MS = 2000;

export type DictationRouteProps = Omit<DictationScreenProps, 'lang'> & {
  bookRepository: BookRepository;
};

export function DictationRoute({ bookRepository, ...screenProps }: DictationRouteProps) {
  // undefined = still loading; null = no usable language
  const [bookLanguage, setBookLanguage] = useState<string | null | undefined>(undefined);
  const { bookId } = screenProps.chapter;

  useEffect(() => {
    let cancelled = false;
    const settle = (language: string | null) => {
      if (!cancelled) setBookLanguage((current) => (current === undefined ? language : current));
    };
    // a lookup that never answers (offline, nothing cached) must not block dictation
    const timer = setTimeout(() => settle(null), BOOK_LOOKUP_TIMEOUT_MS);
    bookRepository
      .getBook(bookId)
      .then((book) => settle(book?.language ?? null))
      .catch(() => settle(null));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bookRepository, bookId]);

  if (bookLanguage === undefined) return <View testID="dictation-loading" style={{ flex: 1 }} />;
  return <DictationScreen {...screenProps} lang={bookLanguage ?? undefined} />;
}
