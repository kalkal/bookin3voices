import { filterNotesByTag } from '../noteFilter';
import type { Note } from '../types';

function note(id: string, tag: Note['tag']): Note {
  return {
    id,
    bookId: 'libro-1',
    schemaVersion: 1,
    text: `nota ${id}`,
    tag,
    createdAt: 1,
    updatedAt: 1,
  };
}

const notes: Note[] = [
  note('a', 'trama'),
  note('b', null),
  note('c', 'dialogo'),
  note('d', 'trama'),
];

describe('filterNotesByTag', () => {
  it('null ("Tutte") returns all notes preserving the order', () => {
    expect(filterNotesByTag(notes, null).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a tag keeps only the notes with that tag, in the original order', () => {
    expect(filterNotesByTag(notes, 'trama').map((n) => n.id)).toEqual(['a', 'd']);
    expect(filterNotesByTag(notes, 'dialogo').map((n) => n.id)).toEqual(['c']);
  });

  it('a tag with no notes gives an empty list; untagged notes never match a filter', () => {
    expect(filterNotesByTag(notes, 'atmosfera')).toEqual([]);
    expect(filterNotesByTag(notes, 'dubbio')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const originale = [...notes];
    filterNotesByTag(notes, null).push(note('z', null));
    expect(notes).toEqual(originale);
  });
});
