import { decodeChapterDoc, toChapter, toChapterSummary } from '../chapterCodec';

const validDoc = {
  schemaVersion: 1,
  order: 2,
  title: 'La marea',
  status: 'draft',
  wordCount: 1248,
  rawText: 'Il faro era spento.',
  updatedAt: 1_757_000_000_000,
};

describe('chapterCodec', () => {
  it('decodifica un documento conforme (outline assente → null, campo additivo della sinossi)', () => {
    expect(decodeChapterDoc(validDoc)).toEqual({ ...validDoc, outline: null });
  });

  it('decodifica un documento con outline (Fase 2)', () => {
    const outline = { summary: 'La marea sale.', beats: ['Il molo', 'La secca'] };
    expect(decodeChapterDoc({ ...validDoc, outline })).toEqual({
      ...validDoc,
      // beatsDone assente (documenti precedenti all'outline) → normalizzato a [] senza bump
      outline: { ...outline, beatsDone: [] },
    });
    expect(decodeChapterDoc({ ...validDoc, outline: { summary: 1 } })).toBeNull();
  });

  it('conserva i beat spuntati in dettatura e rifiuta indici non validi', () => {
    const outline = { summary: 'La marea sale.', beats: ['Il molo', 'La secca'], beatsDone: [1] };
    expect(decodeChapterDoc({ ...validDoc, outline })).toEqual({ ...validDoc, outline });
    expect(decodeChapterDoc({ ...validDoc, outline: { ...outline, beatsDone: [-1] } })).toBeNull();
  });

  it('rifiuta payload non conformi senza lanciare (decide il chiamante)', () => {
    expect(decodeChapterDoc({})).toBeNull();
    expect(decodeChapterDoc({ ...validDoc, schemaVersion: 99 })).toBeNull();
    expect(decodeChapterDoc({ ...validDoc, status: 'pubblicato' })).toBeNull();
    expect(decodeChapterDoc({ ...validDoc, wordCount: -1 })).toBeNull();
    expect(decodeChapterDoc({ ...validDoc, updatedAt: 'ieri' })).toBeNull();
  });

  it('toChapter/toChapterSummary aggiungono le coordinate e tolgono il testo', () => {
    const doc = decodeChapterDoc(validDoc);
    expect(doc).not.toBeNull();
    const chapter = toChapter('cap-1', 'libro-1', doc!);
    expect(chapter).toMatchObject({ id: 'cap-1', bookId: 'libro-1', rawText: validDoc.rawText });
    const summary = toChapterSummary(chapter);
    expect(summary).toEqual({
      id: 'cap-1',
      bookId: 'libro-1',
      order: 2,
      title: 'La marea',
      status: 'draft',
      wordCount: 1248,
      updatedAt: validDoc.updatedAt,
    });
    expect('rawText' in summary).toBe(false);
  });
});
