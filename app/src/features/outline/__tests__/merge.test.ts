// Merge additivo della scaletta (VINCOLANTE): i capitoli con
// testo non si toccano MAI; le schede riempiono prima gli slot vuoti in
// ordine, il resto va in coda; niente eliminazioni.

import { InMemoryChapterRepository } from '../../chapters';
import type { ChapterSummary } from '../../chapters';
import { applyOutlineMerge, planOutlineMerge } from '../merge';
import type { OutlineCard } from '../types';

const BOOK = 'faro';

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
  it('senza capitoli esistenti: tutte le schede diventano creazioni, in ordine', () => {
    const plan = planOutlineMerge([], [card(1), card(2)]);
    expect(plan.updates).toEqual([]);
    expect(plan.creates.map((c) => c.title)).toEqual(['Scheda 1', 'Scheda 2']);
  });

  it('le schede riempiono PRIMA gli slot vuoti (in ordine), il resto va in coda', () => {
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

  it('i capitoli con testo non compaiono MAI nel piano', () => {
    const chapters = [summary('scritto-1', 0, 300), summary('scritto-2', 1, 500)];
    const plan = planOutlineMerge(chapters, [card(1)]);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toHaveLength(1);
  });

  it('meno schede che slot vuoti: gli slot in più restano intoccati', () => {
    const chapters = [summary('vuoto-1', 0, 0), summary('vuoto-2', 1, 0)];
    const plan = planOutlineMerge(chapters, [card(1)]);
    expect(plan.updates.map((u) => u.chapterId)).toEqual(['vuoto-1']);
    expect(plan.creates).toEqual([]);
  });

  it('gli slot vuoti si riempiono nell’ordine del libro anche se la lista è disordinata', () => {
    const chapters = [summary('vuoto-b', 3, 0), summary('vuoto-a', 1, 0)];
    const plan = planOutlineMerge(chapters, [card(1), card(2)]);
    expect(plan.updates.map((u) => u.chapterId)).toEqual(['vuoto-a', 'vuoto-b']);
  });
});

describe('applyOutlineMerge', () => {
  it('aggiorna gli slot vuoti (titolo+outline) e crea i capitoli in più, status draft', async () => {
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

  it('doppia difesa: uno slot pianificato come vuoto ma ORA con testo viene saltato', async () => {
    const repo = new InMemoryChapterRepository();
    repo.seed({ bookId: BOOK, chapterId: 'vuoto-1' }, '', { title: 'Era vuoto', order: 0 });
    // il piano nasce da summary NON aggiornati (wordCount 0)...
    const stale = [summary('vuoto-1', 0, 0)];
    const plan = planOutlineMerge(stale, [card(1)]);
    // ...ma nel frattempo il capitolo ha preso testo (es. dettatura su altro tab)
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
