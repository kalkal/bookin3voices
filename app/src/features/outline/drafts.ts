// The outline proposal the user is still reviewing (cards edited or deleted,
// not yet confirmed), kept per book so it survives leaving the Synopsis tab or
// closing the app. On the device (AsyncStorage), like the settings: a draft is
// work in progress of one phone, and saving it must not touch the book document
// (that would reorder the Library on every card edit). Confirming or
// discarding the proposal clears it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { KeyValueStorage } from '../chapters';
import { outlineCardSchema, type OutlineCard } from './types';

export interface OutlineDraftRepository {
  /** The saved draft of the book, or null when there is none (or it is unreadable). */
  load(bookId: string): Promise<OutlineCard[] | null>;
  save(bookId: string, cards: readonly OutlineCard[]): Promise<void>;
  clear(bookId: string): Promise<void>;
}

const draftSchema = z.object({
  schemaVersion: z.literal(1),
  cards: z.array(outlineCardSchema),
});

const keyOf = (bookId: string) => `bookvoice/outlineDraft/${bookId}`;

export class LocalOutlineDraftRepository implements OutlineDraftRepository {
  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage = AsyncStorage) {
    this.storage = storage;
  }

  async load(bookId: string): Promise<OutlineCard[] | null> {
    const raw = await this.storage.getItem(keyOf(bookId));
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null) return null;
      return draftSchema.parse(parsed).cards;
    } catch {
      // corrupt or future schema: no draft, the user can generate again
      return null;
    }
  }

  async save(bookId: string, cards: readonly OutlineCard[]): Promise<void> {
    await this.storage.setItem(keyOf(bookId), JSON.stringify({ schemaVersion: 1, cards }));
  }

  async clear(bookId: string): Promise<void> {
    // KeyValueStorage has no remove: a JSON null marks "no draft"
    await this.storage.setItem(keyOf(bookId), 'null');
  }
}

/** In memory, for tests and E2E mode. */
export class InMemoryOutlineDraftRepository implements OutlineDraftRepository {
  private readonly drafts = new Map<string, OutlineCard[]>();

  async load(bookId: string): Promise<OutlineCard[] | null> {
    const cards = this.drafts.get(bookId);
    return cards === undefined ? null : cards.map((card) => ({ ...card, beats: [...card.beats] }));
  }

  async save(bookId: string, cards: readonly OutlineCard[]): Promise<void> {
    this.drafts.set(
      bookId,
      cards.map((card) => ({ ...card, beats: [...card.beats] })),
    );
  }

  async clear(bookId: string): Promise<void> {
    this.drafts.delete(bookId);
  }
}
