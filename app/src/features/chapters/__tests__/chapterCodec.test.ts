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
  it('decodes a conforming document (outline absent → null, additive synopsis field)', () => {
    expect(decodeChapterDoc(validDoc)).toEqual({ ...validDoc, outline: null });
  });

  it('decodes a document with an outline', () => {
    const outline = { summary: 'La marea sale.', beats: ['Il molo', 'La secca'] };
    expect(decodeChapterDoc({ ...validDoc, outline })).toEqual({
      ...validDoc,
      // beatsDone absent (documents predating the outline) → normalized to [] without a bump
      outline: { ...outline, beatsDone: [] },
    });
    expect(decodeChapterDoc({ ...validDoc, outline: { summary: 1 } })).toBeNull();
  });

  it('keeps the beats ticked in dictation and rejects invalid indices', () => {
    const outline = { summary: 'La marea sale.', beats: ['Il molo', 'La secca'], beatsDone: [1] };
    expect(decodeChapterDoc({ ...validDoc, outline })).toEqual({ ...validDoc, outline });
    expect(decodeChapterDoc({ ...validDoc, outline: { ...outline, beatsDone: [-1] } })).toBeNull();
  });

  it('rejects non-conforming payloads without throwing (the caller decides)', () => {
    expect(decodeChapterDoc({})).toBeNull();
    expect(decodeChapterDoc({ ...validDoc, schemaVersion: 99 })).toBeNull();
    expect(decodeChapterDoc({ ...validDoc, status: 'pubblicato' })).toBeNull();
    expect(decodeChapterDoc({ ...validDoc, wordCount: -1 })).toBeNull();
    expect(decodeChapterDoc({ ...validDoc, updatedAt: 'ieri' })).toBeNull();
  });

  it('toChapter/toChapterSummary add the coordinates and drop the text', () => {
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
