import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  connectAuthEmulator,
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from 'firebase/auth';
import { connectFirestoreEmulator, Firestore, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, Functions, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, FirebaseStorage, getStorage } from 'firebase/storage';

// In development we work ONLY against the Emulator Suite: the projectId is the
// demo project demo-bookvoice (as in .firebaserc, never a real project) and the
// default apiKey is fake, so no call can reach the cloud. The real config
// (web app apiKey/appId) comes via EXPO_PUBLIC_*.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'emulator-fake-api-key',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'demo-bookvoice.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-bookvoice',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'demo-bookvoice.appspot.com',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? 'emulator-fake-app-id',
};

// From a device/Android emulator "localhost" is not the PC: use 10.0.2.2 on the
// Android emulator, the machine's IP on a physical device (override via EXPO_PUBLIC_EMULATOR_HOST).
const emulatorHost = process.env.EXPO_PUBLIC_EMULATOR_HOST ?? '127.0.0.1';

const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

// On React Native, Auth must be initialized with AsyncStorage persistence,
// otherwise the (anonymous) uid changes on every restart and the data under
// users/{uid} becomes orphaned. getReactNativePersistence only exists in the
// SDK's react-native build: in tests (node build) we fall back to getAuth.
function createAuth(firebaseApp: FirebaseApp): Auth {
  try {
    if (typeof getReactNativePersistence === 'function') {
      return initializeAuth(firebaseApp, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    }
  } catch {
    // already initialized (fast refresh): reuse the existing instance
  }
  return getAuth(firebaseApp);
}

export const auth: Auth = createAuth(app);
export const firestore: Firestore = getFirestore(app);
export const functions: Functions = getFunctions(app);
export const storage: FirebaseStorage = getStorage(app);

// Avoids duplicate connections on fast refresh: connect*Emulator is not idempotent.
declare global {
  var __bookvoiceEmulatorsConnected: boolean | undefined;
}

if (__DEV__ && !globalThis.__bookvoiceEmulatorsConnected) {
  globalThis.__bookvoiceEmulatorsConnected = true;
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, emulatorHost, 8080);
  connectFunctionsEmulator(functions, emulatorHost, 5001);
  connectStorageEmulator(storage, emulatorHost, 9199);
}
