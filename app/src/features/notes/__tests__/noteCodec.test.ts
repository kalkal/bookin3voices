import { decodeNoteDoc, toNote, upgradeNoteData } from '../noteCodec';

const validDoc = {
  schemaVersion: 1,
  text: 'E se il faro fosse la prigione, non il rifugio?',
  tag: 'trama',
  createdAt: 1_757_000_000_000,
  updatedAt: 1_757_000_000_500,
};

describe('noteCodec', () => {
  it('decodifica un documento conforme', () => {
    expect(decodeNoteDoc(validDoc)).toEqual(validDoc);
  });

  it('normalizza il tag assente a null (campo additivo, upgrade-on-read)', () => {
    const { tag, ...senzaTag } = validDoc;
    void tag;
    expect(decodeNoteDoc(senzaTag)).toEqual({ ...senzaTag, tag: null });
    expect(decodeNoteDoc({ ...validDoc, tag: null })).toEqual({ ...validDoc, tag: null });
  });

  it('rifiuta payload non conformi senza lanciare (decide il chiamante)', () => {
    expect(decodeNoteDoc({})).toBeNull();
    expect(decodeNoteDoc({ ...validDoc, schemaVersion: 99 })).toBeNull();
    expect(decodeNoteDoc({ ...validDoc, tag: 'sconosciuto' })).toBeNull();
    expect(decodeNoteDoc({ ...validDoc, text: 42 })).toBeNull();
    expect(decodeNoteDoc({ ...validDoc, createdAt: 'ieri' })).toBeNull();
  });

  it('upgradeNoteData è oggi l’identità (una sola versione di schema)', () => {
    expect(upgradeNoteData(validDoc)).toEqual(validDoc);
  });

  it('toNote aggiunge le coordinate id/bookId', () => {
    const doc = decodeNoteDoc(validDoc);
    expect(doc).not.toBeNull();
    expect(toNote('nota-1', 'libro-1', doc!)).toEqual({
      ...validDoc,
      id: 'nota-1',
      bookId: 'libro-1',
    });
  });
});
