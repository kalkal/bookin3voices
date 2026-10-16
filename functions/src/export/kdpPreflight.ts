// KDP preflight: checks a book BEFORE export and reports what Amazon KDP
// would reject or what makes the listing look unfinished. Pure function, no
// I/O: it runs in the exportBook callable and is unit-tested exhaustively.
//
// Limits used (Amazon KDP help pages, checked October 2026 - verify before
// relying on them, KDP changes them from time to time):
//  - title: at most 200 characters; description: at most 4,000 characters;
//  - eBook cover: JPEG/TIFF, at least 625 px on the shortest side and 1,000 px
//    on the longest, ideal 2,560 x 1,600 px (height : width = 1.6), up to 50 MB.
// The length thresholds are editorial heuristics, not KDP rules.

export const KDP_LIMITS = {
  maxTitleChars: 200,
  maxDescriptionChars: 4000,
  cover: {
    minShortSidePx: 625,
    minLongSidePx: 1000,
    idealRatio: 1.6,
    ratioTolerance: 0.15,
    maxBytes: 50 * 1024 * 1024,
  },
  /** Below this the book is almost certainly not ready. */
  minWordsError: 100,
  /** Below this readers will see a very short book: warn. */
  minWordsWarning: 2500,
} as const;

export interface PreflightCover {
  width: number;
  height: number;
  bytes?: number;
  /** MIME type, e.g. image/jpeg. */
  mimeType?: string;
}

export interface PreflightBook {
  title: string;
  author: string;
  description: string;
  language: string;
  chapters: { title: string; rawText: string }[];
  /** Cover metadata, when the app has one. */
  cover?: PreflightCover | null;
}

export interface PreflightOptions {
  /** Treat a missing cover as an error instead of a warning. */
  requireCover?: boolean;
}

export type PreflightCode =
  | 'title_missing'
  | 'title_too_long'
  | 'author_missing'
  | 'description_missing'
  | 'description_too_long'
  | 'language_missing'
  | 'no_chapters'
  | 'chapter_title_missing'
  | 'chapter_empty'
  | 'chapter_title_duplicate'
  | 'too_short'
  | 'short_book'
  | 'cover_missing'
  | 'cover_too_small'
  | 'cover_bad_ratio'
  | 'cover_bad_format'
  | 'cover_too_large';

export interface PreflightIssue {
  code: PreflightCode;
  message: string;
  /** 1-based chapter position, when the issue is about one chapter. */
  chapter?: number;
}

export interface PreflightReport {
  /** True when there are no errors (warnings do not block). */
  ok: boolean;
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  stats: { chapters: number; words: number };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

const normalizeTitle = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ');

function checkCover(
  cover: PreflightCover | null | undefined,
  requireCover: boolean,
  errors: PreflightIssue[],
  warnings: PreflightIssue[],
): void {
  const c = KDP_LIMITS.cover;
  if (cover === undefined || cover === null) {
    const issue: PreflightIssue = {
      code: 'cover_missing',
      message: 'No cover image attached. KDP requires a cover to publish an eBook.',
    };
    (requireCover ? errors : warnings).push(issue);
    return;
  }
  const short = Math.min(cover.width, cover.height);
  const long = Math.max(cover.width, cover.height);
  if (!(short > 0) || short < c.minShortSidePx || long < c.minLongSidePx) {
    errors.push({
      code: 'cover_too_small',
      message: `Cover is ${cover.width}x${cover.height}px; KDP needs at least ${c.minShortSidePx}px on the shortest side and ${c.minLongSidePx}px on the longest (ideal 2560x1600).`,
    });
  } else {
    const ratio = long / short;
    if (Math.abs(ratio - c.idealRatio) / c.idealRatio > c.ratioTolerance) {
      warnings.push({
        code: 'cover_bad_ratio',
        message: `Cover height:width ratio is ${ratio.toFixed(2)}; KDP recommends ${c.idealRatio}:1.`,
      });
    }
  }
  if (cover.mimeType !== undefined && !/^image\/(jpeg|jpg|tiff)$/i.test(cover.mimeType)) {
    errors.push({
      code: 'cover_bad_format',
      message: `Cover format ${cover.mimeType} is not accepted; use JPEG or TIFF.`,
    });
  }
  if (cover.bytes !== undefined && cover.bytes > c.maxBytes) {
    errors.push({ code: 'cover_too_large', message: 'Cover file is larger than 50 MB.' });
  }
}

export function runKdpPreflight(
  book: PreflightBook,
  options: PreflightOptions = {},
): PreflightReport {
  const errors: PreflightIssue[] = [];
  const warnings: PreflightIssue[] = [];

  const title = book.title.trim();
  if (title === '') {
    errors.push({ code: 'title_missing', message: 'The book has no title.' });
  } else if (title.length > KDP_LIMITS.maxTitleChars) {
    errors.push({
      code: 'title_too_long',
      message: `The title has ${title.length} characters; KDP allows at most ${KDP_LIMITS.maxTitleChars}.`,
    });
  }

  if (book.author.trim() === '') {
    errors.push({ code: 'author_missing', message: 'The book has no author name.' });
  }

  const description = book.description.trim();
  if (description === '') {
    warnings.push({
      code: 'description_missing',
      message: 'No description: KDP asks for one when you publish.',
    });
  } else if (description.length > KDP_LIMITS.maxDescriptionChars) {
    errors.push({
      code: 'description_too_long',
      message: `The description has ${description.length} characters; KDP allows at most ${KDP_LIMITS.maxDescriptionChars}.`,
    });
  }

  if (book.language.trim() === '') {
    warnings.push({
      code: 'language_missing',
      message: 'No language set; the export falls back to "it".',
    });
  }

  let words = 0;
  if (book.chapters.length === 0) {
    errors.push({
      code: 'no_chapters',
      message: 'The book has no chapters: the table of contents would be empty.',
    });
  }
  const seen = new Map<string, number>();
  book.chapters.forEach((chapter, index) => {
    const position = index + 1;
    const chapterWords = countWords(chapter.rawText);
    words += chapterWords;
    if (chapter.title.trim() === '') {
      errors.push({
        code: 'chapter_title_missing',
        chapter: position,
        message: `Chapter ${position} has no title: its table of contents entry would be blank.`,
      });
    } else {
      const key = normalizeTitle(chapter.title);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, position);
      } else {
        warnings.push({
          code: 'chapter_title_duplicate',
          chapter: position,
          message: `Chapter ${position} has the same title as chapter ${first}.`,
        });
      }
    }
    if (chapterWords === 0) {
      errors.push({
        code: 'chapter_empty',
        chapter: position,
        message: `Chapter ${position} is empty.`,
      });
    }
  });

  if (book.chapters.length > 0) {
    if (words < KDP_LIMITS.minWordsError) {
      errors.push({
        code: 'too_short',
        message: `The book has only ${words} words (minimum ${KDP_LIMITS.minWordsError}).`,
      });
    } else if (words < KDP_LIMITS.minWordsWarning) {
      warnings.push({
        code: 'short_book',
        message: `The book has ${words} words; under ${KDP_LIMITS.minWordsWarning} it reads as a very short book.`,
      });
    }
  }

  checkCover(book.cover, options.requireCover === true, errors, warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: { chapters: book.chapters.length, words },
  };
}
