// First-run seeding of the sample book in the user's own space.
// Two guards, in this order:
//  - the database: createBookIfMissing writes book + chapters with fixed ids
//    only when the book does not exist (a transaction on Firestore), so racing
//    starts and reinstalls never duplicate anything;
//  - a local marker, set once the book is there: a user who deletes the sample
//    book does not see it come back on the next start.
// Only for a judge (access code accepted): without the claim the app stays
// offline on createOfflineSampleRepositories. Concurrent calls in the same
// process share one run. A failure (offline, permissions) is logged and retried
// on the next call: never an error on screen.

import type { BookSeeder, SeedOutcome } from '../books/types';
import type { KeyValueStorage } from '../chapters';
import { SAMPLE_BOOK_ID, sampleBookDocs } from './sampleBook';

export type SampleSeedOutcome = SeedOutcome | 'already-seeded' | 'failed';

export interface SampleBookSeedDeps {
  store: BookSeeder;
  /** Local storage of the "already seeded" marker (AsyncStorage in the app). */
  marker: KeyValueStorage;
  /** Owner of the data: the marker is per user. */
  uid: string;
  /** Injectable clock (tests). */
  now?: () => number;
}

const MARKER_VERSION = 'v1';

export function sampleSeedMarkerKey(uid: string): string {
  return `bookvoice.sampleBook.${MARKER_VERSION}.${uid}`;
}

const inFlight = new WeakMap<BookSeeder, Map<string, Promise<SampleSeedOutcome>>>();

/** Creates the sample book once per user; safe to call on every start. */
export function ensureSampleBook(deps: SampleBookSeedDeps): Promise<SampleSeedOutcome> {
  const perStore = inFlight.get(deps.store) ?? new Map<string, Promise<SampleSeedOutcome>>();
  inFlight.set(deps.store, perStore);
  const running = perStore.get(deps.uid);
  if (running !== undefined) return running;
  const run = seed(deps).finally(() => perStore.delete(deps.uid));
  perStore.set(deps.uid, run);
  return run;
}

async function seed({
  store,
  marker,
  uid,
  now = Date.now,
}: SampleBookSeedDeps): Promise<SampleSeedOutcome> {
  const key = sampleSeedMarkerKey(uid);
  try {
    if ((await marker.getItem(key)) !== null) return 'already-seeded';
  } catch {
    // unreadable marker: the database check below still prevents duplicates
  }
  let outcome: SeedOutcome;
  try {
    const { book, chapters } = sampleBookDocs(now());
    outcome = await store.createBookIfMissing(SAMPLE_BOOK_ID, book, chapters);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    console.warn('sample-book-seed-failed', {
      code: typeof code === 'string' ? code : error instanceof Error ? error.name : 'unknown',
    });
    return 'failed';
  }
  try {
    await marker.setItem(key, String(now()));
  } catch {
    // without the marker the next start asks the database again: still no duplicates
  }
  console.info('sample-book-seed', { outcome });
  return outcome;
}

/**
 * Entry point for the access-code flow: call it right after the code is
 * accepted (and the ID token refreshed, so the `judge` claim is on it), with
 * the Firestore book repository of the signed-in user. Idempotent.
 */
export function seedSampleBook(repos: {
  bookRepository: BookSeeder;
  marker: KeyValueStorage;
  uid: string;
}): Promise<SampleSeedOutcome> {
  return ensureSampleBook({ store: repos.bookRepository, marker: repos.marker, uid: repos.uid });
}
