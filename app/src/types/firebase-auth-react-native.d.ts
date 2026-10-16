// The react-native build of @firebase/auth exports getReactNativePersistence,
// but the public types of `firebase/auth` (browser) do not declare it: this
// augmentation aligns the typecheck with what Metro actually resolves at runtime.
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
