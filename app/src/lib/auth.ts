// Identity bootstrap: the data model lives under users/{uid}, but there is
// no login flow yet. Declared assumption: ANONYMOUS sign-in — with
// AsyncStorage persistence the uid survives restarts, and a real login can
// later hook in here (linkWithCredential) without touching the repositories.

import { onAuthStateChanged, signInAnonymously, type Auth } from 'firebase/auth';

/**
 * Resolves with the current user's uid, signing in anonymously on first
 * launch. Rejects only if the anonymous sign-in also fails (e.g. emulator
 * not running): the caller decides how to present the error.
 */
export function ensureSignedIn(auth: Auth): Promise<string> {
  return new Promise((resolve, reject) => {
    let signingIn = false;
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user !== null) {
          unsubscribe();
          resolve(user.uid);
          return;
        }
        if (signingIn) return;
        signingIn = true;
        signInAnonymously(auth).catch((error) => {
          unsubscribe();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}
