// La build react-native di @firebase/auth esporta getReactNativePersistence,
// ma i tipi pubblici di `firebase/auth` (browser) non la dichiarano: questa
// augmentation allinea il typecheck a ciò che Metro risolve davvero a runtime.
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
