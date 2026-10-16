// LOCAL and TEMPORARY implementation of SettingsRepository on AsyncStorage,
// same approach as dictation (LocalChapterRepository): the Firestore integration will replace it
// with the `settings/app` Firestore document without touching the UI.
//
// Unlike chapters, a corrupt payload here does NOT go to quarantine:
// settings can be rebuilt in one tap, so we start again from the defaults.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { KeyValueStorage } from '../chapters';
import { appSettingsSchema, DEFAULT_SETTINGS } from './types';
import type { AppSettings, SettingsRepository } from './types';

const STORAGE_KEY = 'bookvoice/settings/app';

export class LocalSettingsRepository implements SettingsRepository {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = AsyncStorage) {
    this.storage = storage;
  }

  async load(): Promise<AppSettings> {
    const raw = await this.storage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    try {
      return appSettingsSchema.parse(JSON.parse(raw));
    } catch {
      // corrupt or future schema: defaults, never a crash at startup
      return DEFAULT_SETTINGS;
    }
  }

  async save(settings: AppSettings): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}
