// Public API of the Notebook feature: contract, pure codec and filter,
// implementations (Firestore, in-memory for tests/E2E) and screen.

export type {
  CreateNoteInput,
  Note,
  NoteDoc,
  NotePatch,
  NoteRef,
  NoteRepository,
  NoteTag,
  Unsubscribe,
} from './types';
export { NOTE_TAGS, noteDocSchema } from './types';
export { decodeNoteDoc, toNote, upgradeNoteData } from './noteCodec';
export { filterNotesByTag } from './noteFilter';
export type { NoteFilter } from './noteFilter';
export { FirestoreNoteRepository } from './FirestoreNoteRepository';
export type {
  FirestoreNoteRepositoryOptions,
  SyncableNoteRepository,
} from './FirestoreNoteRepository';
export { LocalNoteRepository } from './LocalNoteRepository';
export type { KeyValueStorage } from './LocalNoteRepository';
export { OfflineFirstNoteRepository } from './OfflineFirstNoteRepository';
export type { OfflineFirstNoteRepositoryOptions } from './OfflineFirstNoteRepository';
export { InMemoryNoteRepository } from './InMemoryNoteRepository';
export { NotesScreen } from './NotesScreen';
export type { NotesScreenProps } from './NotesScreen';
export { NoteCaptureModal } from './NoteCaptureModal';
export type { NoteCaptureModalProps } from './NoteCaptureModal';
