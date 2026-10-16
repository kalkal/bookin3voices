// Additive merge of the confirmed outline (BINDING): regeneration
// NEVER touches chapters with non-empty rawText. Confirmed cards
// first fill the existing empty chapters (in order), the rest
// becomes new chapters at the end. No deletions: only additions/edits
// to empty slots — an extra empty chapter stays where it is.
//
// Double defense: the plan is computed on the summaries (wordCount === 0), but BEFORE
// every update the real rawText is re-read from the repository — if in the meantime
// the chapter has gained text, it is skipped (never blind application).

import type { ChapterOutline, ChapterRepository, ChapterSummary } from '../chapters';
import type { OutlineCard } from './types';

export interface OutlineMergePlan {
  /** Existing empty chapters to fill with title+outline, in order. */
  updates: { chapterId: string; title: string; outline: ChapterOutline }[];
  /** Extra cards: new chapters to create at the end, in order. */
  creates: { title: string; outline: ChapterOutline }[];
}

function toOutline(card: OutlineCard): ChapterOutline {
  // empty beatsDone: a (re)generated outline restarts with all beats to do
  return { summary: card.summary, beats: card.beats, beatsDone: [] };
}

/**
 * Pure function: given the current chapters and the confirmed cards, decides what
 * fills which slot. Chapters with words (wordCount > 0) NEVER appear
 * in the plan; empty slots are filled in the book's order.
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
  /** Slots planned as empty but found WITH text on verification: untouched. */
  skipped: number;
}

/** Applies the plan via the repository, re-reading the text before every update. */
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
