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
  it('null ("Tutte") restituisce tutte le note conservando l’ordine', () => {
    expect(filterNotesByTag(notes, null).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('un tag tiene solo le note con quel tag, nell’ordine originale', () => {
    expect(filterNotesByTag(notes, 'trama').map((n) => n.id)).toEqual(['a', 'd']);
    expect(filterNotesByTag(notes, 'dialogo').map((n) => n.id)).toEqual(['c']);
  });

  it('un tag senza note dà lista vuota; le note senza tag non entrano mai in un filtro', () => {
    expect(filterNotesByTag(notes, 'atmosfera')).toEqual([]);
    expect(filterNotesByTag(notes, 'dubbio')).toEqual([]);
  });

  it('non muta l’array di partenza', () => {
    const originale = [...notes];
    filterNotesByTag(notes, null).push(note('z', null));
    expect(notes).toEqual(originale);
  });
});
