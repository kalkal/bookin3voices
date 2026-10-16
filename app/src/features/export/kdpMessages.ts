// KDP check texts live in the `export.kdp.*` keys of the i18n export namespace. The server
// sends a stable `code` and an English message (API); the app shows the translated text
// for the code and falls back to the server message for codes it does not know.

import { t, tn } from '../../i18n';

const KDP_CODES = new Set([
  'cover_missing',
  'cover_too_small',
  'cover_bad_ratio',
  'cover_bad_format',
  'cover_too_large',
  'title_missing',
  'title_too_long',
  'author_missing',
  'description_missing',
  'description_too_long',
  'language_missing',
  'no_chapters',
  'chapter_title_missing',
  'chapter_title_duplicate',
  'chapter_empty',
  'too_short',
  'short_book',
]);

/** Message for a KDP issue in the current UI language (server text for unknown codes). */
export function kdpMessageIt(issue: { code: string; message: string }): string {
  return KDP_CODES.has(issue.code) ? t(`export.kdp.${issue.code}`) : issue.message;
}

/** One-line summary of the KDP check (empty when there is nothing to say). */
export function preflightNote(file: {
  preflight?: {
    errors: { code: string; message: string }[];
    warnings: { code: string; message: string }[];
  };
}): string {
  const report = file.preflight;
  if (report === undefined) return '';
  const issues = [...report.errors, ...report.warnings];
  if (issues.length === 0) return t('export.kdp.allGood');
  const first = issues[0];
  return t('export.kdp.summary', {
    errors: tn('export.kdp.errors', report.errors.length),
    warnings: tn('export.kdp.warnings', report.warnings.length),
    message: first ? kdpMessageIt(first) : '',
  });
}
