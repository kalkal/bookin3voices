// Public API of the books feature: contract, implementations and
// Library/Book screens.

export type {
  Book,
  BookDoc,
  BookPatch,
  BookRepository,
  BookSeeder,
  BookStatus,
  CreateBookInput,
  SeedChapter,
  SeedOutcome,
} from './types';
export { BOOK_STATUSES, bookDocSchema } from './types';
export { decodeBookDoc, newBookDoc, toBook, upgradeBookData } from './bookCodec';
export { FirestoreBookRepository } from './FirestoreBookRepository';
export type { FirestoreBookRepositoryOptions } from './FirestoreBookRepository';
export { InMemoryBookRepository } from './InMemoryBookRepository';
export type { InMemoryBookRepositoryOptions } from './InMemoryBookRepository';
export {
  LocalDailyProgressRepository,
  localDateKey,
  computeStreak,
  reconcileStreak,
  buildHistory,
  MAX_HISTORY_DAYS,
} from './dailyProgress';
export type { DailyProgress, DailyProgressRepository, StreakRecord } from './dailyProgress';
export { LibraryScreen, BOOK_TARGET_WORDS } from './LibraryScreen';
export type { LibraryScreenProps } from './LibraryScreen';
export { BookScreen } from './BookScreen';
export type { BookScreenProps } from './BookScreen';
export { ProgressScreen } from './ProgressScreen';
export type { ProgressScreenProps } from './ProgressScreen';
