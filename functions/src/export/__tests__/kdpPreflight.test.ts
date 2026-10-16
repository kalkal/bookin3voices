import {
  countWords,
  KDP_LIMITS,
  runKdpPreflight,
  type PreflightBook,
  type PreflightReport,
} from '../kdpPreflight';

const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

function goodBook(overrides: Partial<PreflightBook> = {}): PreflightBook {
  return {
    title: 'The Night Shift',
    author: 'Jane Doe',
    description: 'A short thriller.',
    language: 'en',
    chapters: [
      { title: 'One', rawText: words(1500) },
      { title: 'Two', rawText: words(1500) },
    ],
    cover: { width: 1600, height: 2560, mimeType: 'image/jpeg', bytes: 2_000_000 },
    ...overrides,
  };
}

const codes = (issues: { code: string }[]): string[] => issues.map((i) => i.code);

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
    expect(countWords('one two\nthree\t four')).toBe(4);
  });
});

describe('runKdpPreflight', () => {
  it('a complete book passes with no issues', () => {
    expect(runKdpPreflight(goodBook())).toEqual<PreflightReport>({
      ok: true,
      errors: [],
      warnings: [],
      stats: { chapters: 2, words: 3000 },
    });
  });

  describe('metadata', () => {
    it('blank title and author are errors', () => {
      const report = runKdpPreflight(goodBook({ title: '  ', author: '' }));
      expect(report.ok).toBe(false);
      expect(codes(report.errors)).toEqual(
        expect.arrayContaining(['title_missing', 'author_missing']),
      );
    });

    it('a title over 200 characters is an error, exactly 200 is fine', () => {
      const tooLong = runKdpPreflight(goodBook({ title: 'x'.repeat(201) }));
      expect(codes(tooLong.errors)).toContain('title_too_long');
      expect(runKdpPreflight(goodBook({ title: 'x'.repeat(200) })).ok).toBe(true);
    });

    it('missing description and language are warnings, not errors', () => {
      const report = runKdpPreflight(goodBook({ description: '', language: '' }));
      expect(report.ok).toBe(true);
      expect(codes(report.warnings)).toEqual(['description_missing', 'language_missing']);
    });

    it('a description over 4000 characters is an error', () => {
      const report = runKdpPreflight(goodBook({ description: 'd'.repeat(4001) }));
      expect(codes(report.errors)).toContain('description_too_long');
      expect(runKdpPreflight(goodBook({ description: 'd'.repeat(4000) })).ok).toBe(true);
    });
  });

  describe('chapters and table of contents', () => {
    it('no chapters: error, and no length complaint on top', () => {
      const report = runKdpPreflight(goodBook({ chapters: [] }));
      expect(codes(report.errors)).toEqual(['no_chapters']);
      expect(report.stats).toEqual({ chapters: 0, words: 0 });
    });

    it('an empty chapter is reported with its position', () => {
      const report = runKdpPreflight(
        goodBook({
          chapters: [
            { title: 'One', rawText: words(2000) },
            { title: 'Two', rawText: '  \n ' },
            { title: 'Three', rawText: words(2000) },
          ],
        }),
      );
      expect(report.errors).toEqual([
        expect.objectContaining({ code: 'chapter_empty', chapter: 2 }),
      ]);
    });

    it('a chapter without a title blanks its table of contents entry', () => {
      const report = runKdpPreflight(
        goodBook({ chapters: [{ title: ' ', rawText: words(3000) }] }),
      );
      expect(report.errors).toEqual([
        expect.objectContaining({ code: 'chapter_title_missing', chapter: 1 }),
      ]);
    });

    it('duplicate chapter titles are a warning (case and spacing insensitive)', () => {
      const report = runKdpPreflight(
        goodBook({
          chapters: [
            { title: 'The  Door', rawText: words(1500) },
            { title: 'the door', rawText: words(1500) },
          ],
        }),
      );
      expect(report.ok).toBe(true);
      expect(report.warnings).toEqual([
        expect.objectContaining({ code: 'chapter_title_duplicate', chapter: 2 }),
      ]);
    });
  });

  describe('length', () => {
    it('under the hard minimum is an error', () => {
      const report = runKdpPreflight(
        goodBook({ chapters: [{ title: 'One', rawText: words(99) }] }),
      );
      expect(codes(report.errors)).toContain('too_short');
    });

    it('exactly the hard minimum becomes a short-book warning', () => {
      const report = runKdpPreflight(
        goodBook({ chapters: [{ title: 'One', rawText: words(KDP_LIMITS.minWordsError) }] }),
      );
      expect(report.ok).toBe(true);
      expect(codes(report.warnings)).toEqual(['short_book']);
    });

    it('at the warning threshold there is no length warning', () => {
      const report = runKdpPreflight(
        goodBook({ chapters: [{ title: 'One', rawText: words(KDP_LIMITS.minWordsWarning) }] }),
      );
      expect(report.warnings).toEqual([]);
    });
  });

  describe('cover', () => {
    it('missing cover is a warning by default and an error when required', () => {
      const book = goodBook({ cover: undefined });
      expect(codes(runKdpPreflight(book).warnings)).toEqual(['cover_missing']);
      expect(runKdpPreflight(book).ok).toBe(true);
      const strict = runKdpPreflight(book, { requireCover: true });
      expect(strict.ok).toBe(false);
      expect(codes(strict.errors)).toEqual(['cover_missing']);
      const nullCover = runKdpPreflight(goodBook({ cover: null }), { requireCover: true });
      expect(codes(nullCover.errors)).toEqual(['cover_missing']);
    });

    it('too small on either side is an error', () => {
      for (const cover of [
        { width: 600, height: 1600 },
        { width: 800, height: 900 },
        { width: 0, height: 0 },
      ]) {
        expect(codes(runKdpPreflight(goodBook({ cover })).errors)).toContain('cover_too_small');
      }
    });

    it('the minimum size passes; a far-off aspect ratio only warns', () => {
      const minimum = runKdpPreflight(goodBook({ cover: { width: 625, height: 1000 } }));
      expect(minimum.errors).toEqual([]);
      expect(minimum.warnings).toEqual([]);
      const square = runKdpPreflight(goodBook({ cover: { width: 1200, height: 1200 } }));
      expect(square.ok).toBe(true);
      expect(codes(square.warnings)).toEqual(['cover_bad_ratio']);
    });

    it('works in landscape too (the long side decides)', () => {
      const report = runKdpPreflight(goodBook({ cover: { width: 2560, height: 1600 } }));
      expect(report.warnings).toEqual([]);
    });

    it('wrong format and oversize files are errors', () => {
      const png = runKdpPreflight(
        goodBook({ cover: { width: 1600, height: 2560, mimeType: 'image/png' } }),
      );
      expect(codes(png.errors)).toEqual(['cover_bad_format']);
      const big = runKdpPreflight(
        goodBook({ cover: { width: 1600, height: 2560, bytes: 60 * 1024 * 1024 } }),
      );
      expect(codes(big.errors)).toEqual(['cover_too_large']);
    });
  });

  it('collects every problem at once and keeps errors and warnings apart', () => {
    const report = runKdpPreflight({
      title: '',
      author: '',
      description: '',
      language: '',
      chapters: [{ title: '', rawText: '' }],
    });
    expect(report.ok).toBe(false);
    expect(codes(report.errors)).toEqual([
      'title_missing',
      'author_missing',
      'chapter_title_missing',
      'chapter_empty',
      'too_short',
    ]);
    expect(codes(report.warnings)).toEqual([
      'description_missing',
      'language_missing',
      'cover_missing',
    ]);
  });
});
