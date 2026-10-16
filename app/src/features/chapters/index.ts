// API pubblica della feature capitoli: contratti (testo e CRUD completo)
// e implementazioni — Firestore, mirror locale offline-first, in-memory
// per i test.

export type {
  Chapter,
  ChapterDoc,
  ChapterOutline,
  ChapterPatch,
  ChapterRef,
  ChapterRepository,
  ChapterStatus,
  ChapterSummary,
  ChapterTextRepository,
  CreateChapterInput,
  Unsubscribe,
} from './types';
export { CHAPTER_STATUSES, chapterDocSchema, chapterOutlineSchema } from './types';
export { decodeChapterDoc, toChapter, toChapterSummary, upgradeChapterData } from './chapterCodec';
export { FirestoreChapterRepository } from './FirestoreChapterRepository';
export type { FirestoreChapterRepositoryOptions } from './FirestoreChapterRepository';
export { OfflineFirstChapterRepository } from './OfflineFirstChapterRepository';
export type { OfflineFirstChapterRepositoryOptions } from './OfflineFirstChapterRepository';
export { LocalChapterRepository } from './LocalChapterRepository';
export type { KeyValueStorage, MirrorEntry } from './LocalChapterRepository';
export { InMemoryChapterRepository } from './InMemoryChapterRepository';
