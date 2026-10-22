// Offline sample mode (judges build, no `judge` claim yet): the server refuses
// every call without the access code, so the app touches nothing on it. The
// books live in memory with the bundled sample book; refine answers with the
// pre-recorded example suggestions; every other server action (outline,
// export, backup, refine without an example) fails with the same
// `access-code-required` error the server gives, which opens the prompt.
//
// The sample book itself (content, seeding, example suggestions) is another
// feature (features/sample): it plugs in through SampleBookHooks.

import { InMemoryBookRepository, LocalDailyProgressRepository } from '../books';
import type { BookRepository } from '../books';
import { InMemoryChapterRepository } from '../chapters';
import type { ChapterRepository } from '../chapters';
import type { BookExportService, ExportFile, PendingSuggestionsRepository } from '../export';
import { InMemoryPendingSuggestionsRepository, ShareSheetExportFileSink } from '../export';
import { InMemoryNoteRepository } from '../notes';
import type { NoteRepository } from '../notes';
import { InMemoryOutlineDraftRepository } from '../outline';
import type { OutlineProposal, OutlineService } from '../outline';
import { InMemoryRevisionRepository } from '../review';
import type { RefineRequest, RefineResult, SuggestionsProvider } from '../review';
import { LocalSettingsRepository } from '../settings';
import type { BackupFile, BackupService } from '../settings';
import { accessCodeRequiredError } from './accessCodeGate';

/** In-memory repositories already holding the sample book (no network). */
export interface OfflineSampleRepositories {
  bookRepository: BookRepository;
  chapterRepository: ChapterRepository;
  noteRepository: NoteRepository;
  /** Example suggestions only; rejects when there is none for the text. */
  suggestionsProvider: SuggestionsProvider;
}

/** Everything the access gate needs from the sample book feature. */
export interface SampleBookHooks<Services = unknown> {
  /** Offline mode: in-memory repositories pre-filled with the sample book. */
  createOfflineRepositories(): OfflineSampleRepositories;
  /** After a redeem: the sample book in the user's online space (create-if-missing). */
  seedOnline(services: Services, uid: string): Promise<unknown>;
  /** Online with the claim: the live provider, with example suggestions as fallback. */
  wrapOnlineProvider(inner: SuggestionsProvider): SuggestionsProvider;
}

/** No sample book: an empty library offline, the live provider as it is online. */
export const NO_SAMPLE_BOOK: SampleBookHooks = {
  createOfflineRepositories: () => ({
    bookRepository: new InMemoryBookRepository(),
    chapterRepository: new InMemoryChapterRepository(),
    noteRepository: new InMemoryNoteRepository(),
    suggestionsProvider: { refine: async () => Promise.reject(accessCodeRequiredError()) },
  }),
  seedOnline: async () => undefined,
  wrapOnlineProvider: (inner) => inner,
};

/**
 * Refine offline: the example suggestions; when there are none for this text
 * (the user's own book, an edited passage) the access code prompt opens, since
 * only the live AI could answer.
 */
export class OfflineSampleSuggestionsProvider implements SuggestionsProvider {
  constructor(private readonly examples: SuggestionsProvider) {}

  async refine(request: RefineRequest): Promise<RefineResult> {
    try {
      return await this.examples.refine(request);
    } catch {
      throw accessCodeRequiredError();
    }
  }
}

class OfflineOutlineService implements OutlineService {
  async generateOutline(): Promise<OutlineProposal> {
    throw accessCodeRequiredError();
  }
}

class OfflineBookExportService implements BookExportService {
  async exportBook(): Promise<ExportFile> {
    throw accessCodeRequiredError();
  }
}

class OfflineBackupService implements BackupService {
  async exportBackup(): Promise<BackupFile> {
    throw accessCodeRequiredError();
  }
}

/** The services of the offline mode, by their interfaces (no server behind any of them). */
export interface OfflineSampleServices extends Omit<
  OfflineSampleRepositories,
  'suggestionsProvider'
> {
  settingsRepository: LocalSettingsRepository;
  dailyProgressRepository: LocalDailyProgressRepository;
  revisionRepository: InMemoryRevisionRepository;
  suggestionsProvider: SuggestionsProvider;
  exportService: BookExportService;
  pendingSuggestions: PendingSuggestionsRepository;
  exportFileSink: ShareSheetExportFileSink;
  backupService: BackupService;
  outlineService: OutlineService;
  outlineDrafts: InMemoryOutlineDraftRepository;
}

/** The app's services in offline sample mode: nothing reaches the server. */
export function offlineSampleServices(
  hooks: Pick<SampleBookHooks, 'createOfflineRepositories'>,
): OfflineSampleServices {
  const repos = hooks.createOfflineRepositories();
  return {
    bookRepository: repos.bookRepository,
    chapterRepository: repos.chapterRepository,
    noteRepository: repos.noteRepository,
    // interface choices and the daily counter only ever live on the phone
    settingsRepository: new LocalSettingsRepository(),
    dailyProgressRepository: new LocalDailyProgressRepository(),
    revisionRepository: new InMemoryRevisionRepository(),
    suggestionsProvider: new OfflineSampleSuggestionsProvider(repos.suggestionsProvider),
    exportService: new OfflineBookExportService(),
    pendingSuggestions: new InMemoryPendingSuggestionsRepository(0),
    exportFileSink: new ShareSheetExportFileSink(),
    backupService: new OfflineBackupService(),
    outlineService: new OfflineOutlineService(),
    outlineDrafts: new InMemoryOutlineDraftRepository(),
  };
}
