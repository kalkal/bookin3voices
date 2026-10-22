// Free text (a chapter, a synopsis) cannot forbid words: a novel may well
// contain «SELECT» or «ignore previous instructions». It is always handled as
// data: never executed, never put into a query or a path, and the model's
// answer is only proposals validated against the text. On top of that, this
// detector flags suspicious patterns for monitoring: the structured log gets
// the field and the KIND of pattern, never the text itself.

import { logger } from 'firebase-functions';

export type SuspiciousKind =
  'sql-like' | 'script-tag' | 'path-traversal' | 'template-injection' | 'prompt-injection-marker';

const PATTERNS: Array<[SuspiciousKind, RegExp]> = [
  [
    'sql-like',
    /('\s{0,5}or\s{1,5}'?\d{1,10}'?\s{0,5}=\s{0,5}'?\d{1,10})|(;\s{0,5}--)|(\b(select|insert|update|delete|drop|union)\b[^.\n]{0,40}\b(from|into|table|set|where|select)\b)/i,
  ],
  // every repeat is bounded: these run over whole chapters
  [
    'script-tag',
    /<\s{0,5}\/?\s{0,5}script\b|javascript\s{0,5}:|<\w{1,20}[^>]{0,200}\son\w{1,20}\s{0,5}=/i,
  ],
  ['path-traversal', /\.\.[/\\]|%2e%2e(%2f|%5c)/i],
  ['template-injection', /\$\{[^}]{0,200}\}|\{\{[^}]{0,200}\}\}/],
  [
    'prompt-injection-marker',
    /ignore\s{1,5}(all\s{1,5})?(the\s{1,5})?previous\s{1,5}instructions|ignora\s{1,5}(tutte\s{1,5})?le\s{1,5}istruzioni\s{1,5}precedenti|system\s{1,5}(prompt|override)|you\s{1,5}are\s{1,5}no\s{1,5}longer\s{1,5}an?\b/i,
  ],
];

export function detectSuspiciousInput(text: string): SuspiciousKind[] {
  return PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

/** Logs the kinds found in a free-text field (no text), and returns them. */
export function reportSuspiciousInput(
  field: string,
  text: string,
  context: Record<string, unknown>,
): SuspiciousKind[] {
  const kinds = detectSuspiciousInput(text);
  if (kinds.length > 0) {
    logger.warn('input-suspicious', { field, kinds, ...context });
  }
  return kinds;
}
