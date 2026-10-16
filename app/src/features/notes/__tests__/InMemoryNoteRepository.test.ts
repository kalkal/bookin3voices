import { InMemoryNoteRepository } from '../InMemoryNoteRepository';
import type { Note } from '../types';

/** Monotonic clock: every call advances, so the order is deterministic. */
function tickingClock(start = 1000): () => number {
  let t = start;
  return () => (t += 1);
}

describe('InMemoryNoteRepository', () => {
  it('createNote adds a note and observeNotes emits it on top', () => {
    const repo = new InMemoryNoteRepository(tickingClock());
    const emissions: Note[][] = [];
    repo.observeNotes('libro-1', (notes) => emissions.push(notes));
    expect(emissions[0]).toEqual([]);

    return repo.createNote('libro-1', { text: 'Un’idea', tag: 'idea' }).then((created) => {
      expect(created).toMatchObject({ text: 'Un’idea', tag: 'idea', bookId: 'libro-1' });
      const last = emissions[emissions.length - 1];
      expect(last).toHaveLength(1);
      expect(last[0].id).toBe(created.id);
    });
  });

  it('observeNotes orders by createdAt descending (most recent first)', async () => {
    const repo = new InMemoryNoteRepository(tickingClock());
    await repo.createNote('libro-1', { text: 'prima' });
    await repo.createNote('libro-1', { text: 'seconda' });
    await repo.createNote('libro-1', { text: 'terza' });

    let list: Note[] = [];
    const unsubscribe = repo.observeNotes('libro-1', (notes) => (list = notes));
    expect(list.map((n) => n.text)).toEqual(['terza', 'seconda', 'prima']);
    unsubscribe();
  });

  it('optional tag: absent → null', async () => {
    const repo = new InMemoryNoteRepository(tickingClock());
    const created = await repo.createNote('libro-1', { text: 'senza tag' });
    expect(created.tag).toBeNull();
  });

  it('updateNote changes text/tag and bumps updatedAt; getNote reads it back', async () => {
    const clock = tickingClock();
    const repo = new InMemoryNoteRepository(clock);
    const created = await repo.createNote('libro-1', { text: 'bozza', tag: null });
    await repo.updateNote(
      { bookId: 'libro-1', noteId: created.id },
      { text: 'rivista', tag: 'dubbio' },
    );

    const fetched = await repo.getNote({ bookId: 'libro-1', noteId: created.id });
    expect(fetched).toMatchObject({ text: 'rivista', tag: 'dubbio' });
    expect(fetched!.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it('updateNote on a nonexistent note throws', async () => {
    const repo = new InMemoryNoteRepository(tickingClock());
    await expect(
      repo.updateNote({ bookId: 'libro-1', noteId: 'mai-vista' }, { text: 'x' }),
    ).rejects.toThrow(/does not exist/);
  });

  it('deleteNote removes the note and the list updates', async () => {
    const repo = new InMemoryNoteRepository(tickingClock());
    const created = await repo.createNote('libro-1', { text: 'da cancellare' });
    let list: Note[] = [];
    repo.observeNotes('libro-1', (notes) => (list = notes));
    expect(list).toHaveLength(1);

    await repo.deleteNote({ bookId: 'libro-1', noteId: created.id });
    expect(list).toEqual([]);
    expect(await repo.getNote({ bookId: 'libro-1', noteId: created.id })).toBeNull();
  });

  it("the notes of one book do not show up in another book's observe", async () => {
    const repo = new InMemoryNoteRepository(tickingClock());
    await repo.createNote('libro-1', { text: 'del primo' });
    let altro: Note[] = [];
    repo.observeNotes('libro-2', (notes) => (altro = notes));
    expect(altro).toEqual([]);
  });

  it('unsubscribe stops receiving updates', async () => {
    const repo = new InMemoryNoteRepository(tickingClock());
    const emissions: Note[][] = [];
    const unsubscribe = repo.observeNotes('libro-1', (notes) => emissions.push(notes));
    const count = emissions.length;
    unsubscribe();
    await repo.createNote('libro-1', { text: 'dopo l’unsubscribe' });
    expect(emissions).toHaveLength(count);
  });
});
