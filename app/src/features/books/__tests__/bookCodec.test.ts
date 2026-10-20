import { decodeBookDoc, newBookDoc } from '../bookCodec';

const validDoc = {
  schemaVersion: 1,
  title: 'Le arnie del mulino',
  author: 'Jane',
  description: '',
  synopsis: '',
  genre: 'Romanzo',
  language: 'it',
  status: 'draft',
  styleProfileId: null,
  wordCount: 24_310,
  chapterCount: 9,
  createdAt: 1_750_000_000_000,
  updatedAt: 1_757_000_000_000,
};

describe('bookCodec', () => {
  it('decodes a conforming document', () => {
    expect(decodeBookDoc(validDoc)).toEqual(validDoc);
  });

  it('rejects non-conforming payloads without throwing (the caller decides)', () => {
    expect(decodeBookDoc({})).toBeNull();
    expect(decodeBookDoc({ ...validDoc, schemaVersion: 2 })).toBeNull();
    expect(decodeBookDoc({ ...validDoc, wordCount: 'tante' })).toBeNull();
    expect(decodeBookDoc({ ...validDoc, styleProfileId: undefined })).toBeNull();
  });

  it('newBookDoc starts with counters at zero and the Italian defaults', () => {
    const doc = newBookDoc({ title: 'Racconti del mulino' }, 123);
    expect(doc).toMatchObject({
      schemaVersion: 1,
      title: 'Racconti del mulino',
      author: '',
      genre: 'Romanzo',
      language: 'it',
      status: 'draft',
      styleProfileId: null,
      wordCount: 0,
      chapterCount: 0,
      createdAt: 123,
      updatedAt: 123,
    });
    // the starting document must already conform to the schema
    expect(decodeBookDoc(doc as unknown as Record<string, unknown>)).toEqual(doc);
  });
});
