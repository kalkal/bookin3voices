// Smoke test against the Emulator Suite.
// Prerequisite: emulators running (`firebase emulators:start` from the repo root).
// Usage: node scripts/emulator-smoke.mjs   (from the app/ folder)
//
// Checks, with the app's real Firebase SDK:
//  1. email/password signup + sign-in on the Auth emulator;
//  2. `ping` callable on the Functions emulator.

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

// Same projectId as .firebaserc (demo-bookvoice), fake apiKey: with the
// emulators connected below, no call can reach the real project.
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
const password = 'a-test-password-123';

console.log(`[1/3] Signup on Auth emulator (${email})...`);
const created = await createUserWithEmailAndPassword(auth, email, password);
console.log(`      OK — uid: ${created.user.uid}`);

await signOut(auth);

console.log('[2/3] Sign-in with the same credentials...');
const signedIn = await signInWithEmailAndPassword(auth, email, password);
if (signedIn.user.uid !== created.user.uid) {
  throw new Error(`uid differs after sign-in: ${signedIn.user.uid} != ${created.user.uid}`);
}
console.log('      OK — same uid, token obtained.');

console.log('[3/3] Ping callable on Functions emulator...');
const ping = httpsCallable(functions, 'ping');
const pong = await ping({});
console.log(`      OK — response: ${JSON.stringify(pong.data)}`);

console.log('\nSmoke test passed.');
process.exit(0);
