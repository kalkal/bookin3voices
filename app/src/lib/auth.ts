// Bootstrap dell'identità: il modello dati vive sotto users/{uid}
// ma un flusso di login non esiste ancora nel backlog. Assunzione
// dichiarata: accesso ANONIMO — con la persistenza su AsyncStorage la uid
// sopravvive ai riavvii, e un eventuale login vero potrà agganciarsi qui
// (linkWithCredential) senza toccare i repository.

import { onAuthStateChanged, signInAnonymously, type Auth } from 'firebase/auth';

/**
 * Risolve con la uid dell'utente corrente, firmando in modo anonimo al primo
 * avvio. Rifiuta solo se anche il sign-in anonimo fallisce (es. emulatore
 * spento): il chiamante decide come presentare l'errore.
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
