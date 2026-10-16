// Smoke test contro l'Emulator Suite.
// Prerequisito: emulatori attivi (`firebase emulators:start` dalla root del repo).
// Uso: node scripts/emulator-smoke.mjs   (dalla cartella app/)
//
// Verifica, con il vero SDK Firebase dell'app:
//  1. signup + sign-in email/password sull'emulatore Auth;
//  2. callable `ping` sull'emulatore Functions;
//  3. (se GEMINI_SMOKE=1) callable `geminiSmoke` con un TESTO FITTIZIO —
//     mai testo reale del libro: chiave free solo in sviluppo.

import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const HOST = process.env.EMULATOR_HOST ?? '127.0.0.1';

// Stesso projectId di .firebaserc (demo-bookvoice), apiKey fittizia: con gli
// emulatori connessi sotto, nessuna chiamata può raggiungere il progetto reale.
const app = initializeApp({
  apiKey: 'emulator-fake-api-key',
  authDomain: 'demo-bookvoice.firebaseapp.com',
  projectId: 'demo-bookvoice',
  appId: 'emulator-fake-app-id',
});

const auth = getAuth(app);
connectAuthEmulator(auth, `http://${HOST}:9099`, { disableWarnings: true });
const functions = getFunctions(app);
connectFunctionsEmulator(functions, HOST, 5001);

const email = `smoke-${Date.now()}@example.com`;
const password = 'una-password-di-prova-123';

console.log(`[1/3] Signup su Auth emulator (${email})...`);
const created = await createUserWithEmailAndPassword(auth, email, password);
console.log(`      OK — uid: ${created.user.uid}`);

await signOut(auth);

console.log('[2/3] Sign-in con le stesse credenziali...');
const signedIn = await signInWithEmailAndPassword(auth, email, password);
if (signedIn.user.uid !== created.user.uid) {
  throw new Error(`uid diverso dopo il sign-in: ${signedIn.user.uid} != ${created.user.uid}`);
}
console.log('      OK — stessa uid, token ottenuto.');

console.log('[3/3] Callable ping su Functions emulator...');
const ping = httpsCallable(functions, 'ping');
const pong = await ping({});
console.log(`      OK — risposta: ${JSON.stringify(pong.data)}`);

if (process.env.GEMINI_SMOKE === '1') {
  console.log('[extra] Callable geminiSmoke con testo fittizio...');
  const geminiSmoke = httpsCallable(functions, 'geminiSmoke');
  const testoFittizio =
    'Brano di prova inventato: il faro di Punta Brema lampeggiava tre volte, ' +
    'poi taceva. Rispondi con una sola frase di conferma che hai letto il brano.';
  const result = await geminiSmoke({ text: testoFittizio });
  console.log(`      OK — ${JSON.stringify(result.data).slice(0, 300)}`);
}

console.log('\nSmoke test superato.');
process.exit(0);
