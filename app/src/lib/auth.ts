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

/**
 * Judges build: true when the signed-in user's ID token carries the `judge`
 * claim, set by the server once a valid access code is redeemed. Without it
 * the server refuses every call, so the app stays in offline sample mode.
 */
export async function hasJudgeClaim(auth: Auth): Promise<boolean> {
  const user = auth.currentUser;
  if (user === null) return false;
  const token = await user.getIdTokenResult();
  return token.claims.judge === true;
}

/** Fetches a fresh ID token, so a claim just set by the server reaches Firestore and Functions. */
export async function refreshIdToken(auth: Auth): Promise<void> {
  const user = auth.currentUser;
  if (user === null) throw new Error('No signed-in user');
  await user.getIdToken(true);
}
