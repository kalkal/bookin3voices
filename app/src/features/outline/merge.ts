// Merge additivo della scaletta confermata (VINCOLANTE): la
// rigenerazione non tocca MAI capitoli con rawText non vuoto. Le schede
// confermate riempiono prima i capitoli vuoti esistenti (in ordine), il resto
// diventa capitoli nuovi in coda. Niente eliminazioni: solo aggiunte/modifiche
// agli slot vuoti — un capitolo vuoto in più resta dov'è.
//
// Doppia difesa: il piano si calcola sui summary (wordCount === 0), ma PRIMA
// di ogni update si rilegge il rawText vero dal repository — se nel frattempo
// il capitolo ha preso testo, si salta (mai applicazione cieca).

import type { ChapterOutline, ChapterRepository, ChapterSummary } from '../chapters';
import type { OutlineCard } from './types';

export interface OutlineMergePlan {
  /** Capitoli vuoti esistenti da riempire con titolo+outline, in ordine. */
  updates: { chapterId: string; title: string; outline: ChapterOutline }[];
  /** Schede in più: capitoli nuovi da creare in coda, in ordine. */
  creates: { title: string; outline: ChapterOutline }[];
}

function toOutline(card: OutlineCard): ChapterOutline {
  // beatsDone vuoto: una traccia (ri)generata riparte con tutti i beat da fare
  return { summary: card.summary, beats: card.beats, beatsDone: [] };
}

/**
 * Funzione pura: dati i capitoli attuali e le schede confermate, decide chi
 * riempie quale slot. I capitoli con parole (wordCount > 0) non compaiono MAI
 * nel piano; gli slot vuoti si riempiono nell'ordine del libro.
 */
export function planOutlineMerge(
  chapters: readonly ChapterSummary[],
  cards: readonly OutlineCard[],
): OutlineMergePlan {
  const emptySlots = [...chapters]
    .filter((chapter) => chapter.wordCount === 0)
    .sort((a, b) => a.order - b.order);

  const updates: OutlineMergePlan['updates'] = [];
  const creates: OutlineMergePlan['creates'] = [];
  cards.forEach((card, index) => {
    const slot = emptySlots[index];
    if (slot === undefined) {
      creates.push({ title: card.title, outline: toOutline(card) });
    } else {
      updates.push({ chapterId: slot.id, title: card.title, outline: toOutline(card) });
    }
  });
  return { updates, creates };
}

export interface OutlineMergeResult {
  updated: number;
  created: number;
  /** Slot pianificati come vuoti ma trovati CON testo alla verifica: intoccati. */
  skipped: number;
}

/** Applica il piano via repository, rileggendo il testo prima di ogni update. */
export async function applyOutlineMerge(
  repository: ChapterRepository,
  bookId: string,
  plan: OutlineMergePlan,
): Promise<OutlineMergeResult> {
  let updated = 0;
  let skipped = 0;

  for (const update of plan.updates) {
    const rawText = await repository.loadRawText({ bookId, chapterId: update.chapterId });
    if (rawText !== null && rawText.trim() !== '') {
      skipped += 1;
      continue;
    }
    await repository.updateChapter(
      { bookId, chapterId: update.chapterId },
      { title: update.title, outline: update.outline },
    );
    updated += 1;
  }

  for (const create of plan.creates) {
    await repository.createChapter(bookId, { title: create.title, outline: create.outline });
  }

  return { updated, created: plan.creates.length, skipped };
}
