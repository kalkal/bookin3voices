import { decodeBookDoc, newBookDoc } from '../bookCodec';

const validDoc = {
  schemaVersion: 1,
  title: 'Il custode del faro',
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
  it('decodifica un documento conforme', () => {
    expect(decodeBookDoc(validDoc)).toEqual(validDoc);
  });

  it('rifiuta payload non conformi senza lanciare (decide il chiamante)', () => {
    expect(decodeBookDoc({})).toBeNull();
    expect(decodeBookDoc({ ...validDoc, schemaVersion: 2 })).toBeNull();
    expect(decodeBookDoc({ ...validDoc, wordCount: 'tante' })).toBeNull();
    expect(decodeBookDoc({ ...validDoc, styleProfileId: undefined })).toBeNull();
  });

  it('newBookDoc parte con i contatori a zero e i default italiani', () => {
    const doc = newBookDoc({ title: 'Racconti del molo' }, 123);
    expect(doc).toMatchObject({
      schemaVersion: 1,
      title: 'Racconti del molo',
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
    // il documento di partenza deve già essere conforme allo schema
    expect(decodeBookDoc(doc as unknown as Record<string, unknown>)).toEqual(doc);
  });
});
