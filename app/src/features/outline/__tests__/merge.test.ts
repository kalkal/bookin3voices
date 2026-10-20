// Additive outline merge (BINDING): chapters with
// text are NEVER touched; cards fill empty slots first in
// order, the rest goes at the end; no deletions.

import { InMemoryChapterRepository } from '../../chapters';
import type { ChapterSummary } from '../../chapters';
import { applyOutlineMerge, planOutlineMerge } from '../merge';
import type { OutlineCard } from '../types';

const BOOK = 'mulino';

function summary(
  id: string,
  order: number,
  wordCount: number,
  title = `Capitolo ${id}`,
): ChapterSummary {
  return { id, bookId: BOOK, order, title, status: 'draft', wordCount, updatedAt: 0 };
}

function card(n: number): OutlineCard {
  return {
    title: `Scheda ${n}`,
    summary: `Riassunto ${n}`,
    beats: [`beat ${n}.1`, `beat ${n}.2`],
  };
}

describe('planOutlineMerge', () => {
  it('with no existing chapters: all cards become creations, in order', () => {
    const plan = planOutlineMerge([], [card(1), card(2)]);
    expect(plan.updates).toEqual([]);
    expect(plan.creates.map((c) => c.title)).toEqual(['Scheda 1', 'Scheda 2']);
  });

  it('cards fill empty slots FIRST (in order), the rest goes at the end', () => {
    const chapters = [
      summary('scritto-1', 0, 120),
      summary('vuoto-1', 1, 0),
      summary('scritto-2', 2, 80),
      summary('vuoto-2', 3, 0),
    ];
    const plan = planOutlineMerge(chapters, [card(1), card(2), card(3)]);

    expect(plan.updates).toEqual([
      {
        chapterId: 'vuoto-1',
        title: 'Scheda 1',
        outline: { summary: 'Riassunto 1', beats: ['beat 1.1', 'beat 1.2'], beatsDone: [] },
      },
      {
        chapterId: 'vuoto-2',
        title: 'Scheda 2',
        outline: { summary: 'Riassunto 2', beats: ['beat 2.1', 'beat 2.2'], beatsDone: [] },
      },
    ]);
    expect(plan.creates.map((c) => c.title)).toEqual(['Scheda 3']);
  });

  it('chapters with text NEVER appear in the plan', () => {
    const chapters = [summary('scritto-1', 0, 300), summary('scritto-2', 1, 500)];
    const plan = planOutlineMerge(chapters, [card(1)]);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toHaveLength(1);
  });

  it('fewer cards than empty slots: the extra slots stay untouched', () => {
    const chapters = [summary('vuoto-1', 0, 0), summary('vuoto-2', 1, 0)];
    const plan = planOutlineMerge(chapters, [card(1)]);
    expect(plan.updates.map((u) => u.chapterId)).toEqual(['vuoto-1']);
    expect(plan.creates).toEqual([]);
  });

  it("empty slots are filled in the book's order even if the list is unordered", () => {
    const chapters = [summary('vuoto-b', 3, 0), summary('vuoto-a', 1, 0)];
    const plan = planOutlineMerge(chapters, [card(1), card(2)]);
    expect(plan.updates.map((u) => u.chapterId)).toEqual(['vuoto-a', 'vuoto-b']);
  });
});

describe('applyOutlineMerge', () => {
  it('updates empty slots (title+outline) and creates the extra chapters, status draft', async () => {
    const repo = new InMemoryChapterRepository();
    repo.seed({ bookId: BOOK, chapterId: 'vuoto-1' }, '', { title: 'Vuoto', order: 0 });
    const chapters = [summary('vuoto-1', 0, 0)];

    const result = await applyOutlineMerge(
      repo,
      BOOK,
      planOutlineMerge(chapters, [card(1), card(2)]),
    );

    expect(result).toEqual({ updated: 1, created: 1, skipped: 0 });
    const updated = await repo.getChapter({ bookId: BOOK, chapterId: 'vuoto-1' });
    expect(updated).toMatchObject({
      title: 'Scheda 1',
      status: 'draft',
      rawText: '',
      outline: { summary: 'Riassunto 1', beats: ['beat 1.1', 'beat 1.2'] },
    });
    const all = await new Promise<ChapterSummary[]>((resolve) => {
      repo.observeChapters(BOOK, resolve);
    });
    expect(all).toHaveLength(2);
    const created = await repo.getChapter({ bookId: BOOK, chapterId: all[1]?.id ?? '' });
    expect(created).toMatchObject({
      title: 'Scheda 2',
      status: 'draft',
      outline: { summary: 'Riassunto 2', beats: ['beat 2.1', 'beat 2.2'] },
    });
  });

  it('double defense: a slot planned as empty but NOW with text is skipped', async () => {
    const repo = new InMemoryChapterRepository();
    repo.seed({ bookId: BOOK, chapterId: 'vuoto-1' }, '', { title: 'Era vuoto', order: 0 });
    // the plan is built from STALE summaries (wordCount 0)...
    const stale = [summary('vuoto-1', 0, 0)];
    const plan = planOutlineMerge(stale, [card(1)]);
    // ...but in the meantime the chapter has gained text (e.g. dictation on another tab)
    await repo.saveRawText({ bookId: BOOK, chapterId: 'vuoto-1' }, 'Testo dettato nel frattempo.');

    const result = await applyOutlineMerge(repo, BOOK, plan);

    expect(result).toEqual({ updated: 0, created: 0, skipped: 1 });
    const chapter = await repo.getChapter({ bookId: BOOK, chapterId: 'vuoto-1' });
    expect(chapter).toMatchObject({
      title: 'Era vuoto',
      rawText: 'Testo dettato nel frattempo.',
      outline: null,
    });
  });
});
