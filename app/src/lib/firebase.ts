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

// In sviluppo si lavora SOLO contro l'Emulator Suite: il projectId coincide con
// il progetto demo demo-bookvoice (come in .firebaserc, mai un progetto reale) ma l'apiKey di default è
// fittizia, quindi nessuna chiamata può raggiungere il cloud. La config reale
// (apiKey/appId della web app) arriva via EXPO_PUBLIC_*.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? 'emulator-fake-api-key',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'demo-bookvoice.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-bookvoice',
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'demo-bookvoice.appspot.com',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? 'emulator-fake-app-id',
};

// Dal device/emulatore Android "localhost" non è il PC: 10.0.2.2 sull'emulatore
// Android, l'IP della macchina su device fisico (override via EXPO_PUBLIC_EMULATOR_HOST).
const emulatorHost = process.env.EXPO_PUBLIC_EMULATOR_HOST ?? '127.0.0.1';

const app: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

// Su React Native l'Auth va inizializzata con la persistenza su AsyncStorage,
// altrimenti la uid (anonima) cambia a ogni riavvio e i dati sotto
// users/{uid} diventano orfani. getReactNativePersistence esiste solo nella
// build react-native dell'SDK: nei test (build node) si ripiega su getAuth.
function createAuth(firebaseApp: FirebaseApp): Auth {
  try {
    if (typeof getReactNativePersistence === 'function') {
      return initializeAuth(firebaseApp, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    }
  } catch {
    // già inizializzata (fast refresh): si riusa l'istanza esistente
  }
  return getAuth(firebaseApp);
}

export const auth: Auth = createAuth(app);
export const firestore: Firestore = getFirestore(app);
export const functions: Functions = getFunctions(app);
export const storage: FirebaseStorage = getStorage(app);

// Evita doppie connessioni col fast refresh: connect*Emulator non è idempotente.
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
