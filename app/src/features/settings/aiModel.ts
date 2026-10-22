// The AI engine shown in Settings. The server decides it (Amazon Nova on
// Bedrock, functions/src/ai/provider/factory.ts); the app only REPORTS it and
// never offers a choice: an old local choice once named another engine
// while the server used Nova. What is shown is the model the refineChapter
// callable answered with last time, or the server's default before that.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { KeyValueStorage } from '../chapters';

/** Same value as DEFAULT_NOVA_MODEL_ID in functions (pinned by aiModel.test.ts). */
export const DEFAULT_AI_MODEL_ID = 'amazon.nova-pro-v1:0';

/** Readable name of a model id: 'amazon.nova-pro-v1:0' → 'Amazon Nova Pro'. */
export function aiModelLabel(modelId: string): string {
  const nova = /amazon\.nova-([a-z]+)/.exec(modelId);
  if (nova?.[1]) return `Amazon Nova ${nova[1].charAt(0).toUpperCase()}${nova[1].slice(1)}`;
  return modelId;
}

/** Last model the server answered with; null until the first refinement. */
export interface ServedModelSource {
  load(): Promise<string | null>;
}

const STORAGE_KEY = 'bookvoice/ai/servedModel';

export class LocalServedModelStore implements ServedModelSource {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = AsyncStorage) {
    this.storage = storage;
  }

  load(): Promise<string | null> {
    return this.storage.getItem(STORAGE_KEY);
  }

  async save(modelId: string): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, modelId);
  }
}
