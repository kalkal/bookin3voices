import { decodeNoteDoc, toNote, upgradeNoteData } from '../noteCodec';

const validDoc = {
  schemaVersion: 1,
  text: 'E se il faro fosse la prigione, non il rifugio?',
  tag: 'trama',
  createdAt: 1_757_000_000_000,
  updatedAt: 1_757_000_000_500,
};

describe('noteCodec', () => {
  it('decodes a conforming document', () => {
    expect(decodeNoteDoc(validDoc)).toEqual(validDoc);
  });

  it('normalizes an absent tag to null (additive field, upgrade-on-read)', () => {
    const { tag, ...senzaTag } = validDoc;
    void tag;
    expect(decodeNoteDoc(senzaTag)).toEqual({ ...senzaTag, tag: null });
    expect(decodeNoteDoc({ ...validDoc, tag: null })).toEqual({ ...validDoc, tag: null });
  });

  it('rejects non-conforming payloads without throwing (the caller decides)', () => {
    expect(decodeNoteDoc({})).toBeNull();
    expect(decodeNoteDoc({ ...validDoc, schemaVersion: 99 })).toBeNull();
    expect(decodeNoteDoc({ ...validDoc, tag: 'sconosciuto' })).toBeNull();
    expect(decodeNoteDoc({ ...validDoc, text: 42 })).toBeNull();
    expect(decodeNoteDoc({ ...validDoc, createdAt: 'ieri' })).toBeNull();
  });

  it('upgradeNoteData is the identity today (a single schema version)', () => {
    expect(upgradeNoteData(validDoc)).toEqual(validDoc);
  });

  it('toNote adds the id/bookId coordinates', () => {
    const doc = decodeNoteDoc(validDoc);
    expect(doc).not.toBeNull();
    expect(toNote('nota-1', 'libro-1', doc!)).toEqual({
      ...validDoc,
      id: 'nota-1',
      bookId: 'libro-1',
    });
  });
});
