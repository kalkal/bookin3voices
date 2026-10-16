// Implementazione LOCALE e PROVVISORIA di SettingsRepository su AsyncStorage,
// stesso approccio della dettatura (LocalChapterRepository): l'integrazione Firestore la sostituirà
// con il documento Firestore `settings/app` senza toccare la UI.
//
// A differenza dei capitoli, un payload corrotto qui NON va in quarantena:
// le impostazioni si ricostruiscono in un tap, si riparte dai default.

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
      // corrotto o schema futuro: default, mai crash all'avvio
      return DEFAULT_SETTINGS;
    }
  }

  async save(settings: AppSettings): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}
