// Before an export the app waits until the writes saved on the device have
// reached the server (the export callable reads from the server). Offline the
// wait never ends: after the timeout we go on and the caller warns the user.

import { waitForPendingWrites, type Firestore } from 'firebase/firestore';

export const SYNC_WAIT_MS = 3000;

/** Resolves true if all local writes are synced, false after the timeout. */
export async function waitForSyncedWrites(
  firestore: Firestore,
  timeoutMs: number = SYNC_WAIT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const synced = waitForPendingWrites(firestore).then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([synced, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
