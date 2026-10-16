// Text patches for the Command pattern: every acceptance/undo is an
// {span, before, after} object with an inverse. Coexistence rules:
// (b) when a patch is applied, the pending spans are re-mapped;
// (d) a patch verifies that `before` still matches the text at the span
//     before applying: otherwise a clean rejection, NEVER a blind application.

import type { Span } from './types';

export interface TextPatch {
  span: Span;
  /** Text expected at the span (the suggestion calls it `original`). */
  before: string;
  after: string;
}

export type PatchFailure = 'span-out-of-range' | 'original-mismatch';

export type PatchResult = { ok: true; text: string } | { ok: false; reason: PatchFailure };

/** Applies the patch only if `before` still matches the text at the span. */
export function applyPatch(text: string, patch: TextPatch): PatchResult {
  const { from, to } = patch.span;
  if (to > text.length) {
    return { ok: false, reason: 'span-out-of-range' };
  }
  if (text.slice(from, to) !== patch.before) {
    return { ok: false, reason: 'original-mismatch' };
  }
  return { ok: true, text: text.slice(0, from) + patch.after + text.slice(to) };
}

/** Inverse patch: applied after the original, restores the text (undo). */
export function invertPatch(patch: TextPatch): TextPatch {
  return {
    span: { from: patch.span.from, to: patch.span.from + patch.after.length },
    before: patch.after,
    after: patch.before,
  };
}

/**
 * Re-maps a span after `applied` is applied:
 * - entirely before the patch → unchanged;
 * - entirely after → shifted by the length delta;
 * - overlaps the patched zone → 'overlap': the caller marks it stale.
 * Boundaries that touch without intersecting are NOT an overlap.
 */
export function remapSpan(span: Span, applied: TextPatch): Span | 'overlap' {
  if (span.to <= applied.span.from) {
    return span;
  }
  if (span.from >= applied.span.to) {
    const delta = applied.after.length - (applied.span.to - applied.span.from);
    return { from: span.from + delta, to: span.to + delta };
  }
  return 'overlap';
}

/**
 * Reduces a manual edit (whole text before/after) to ONE minimal patch,
 * comparing common prefix and suffix. Enough for the edits of a mobile
 * editor (one touched zone at a time); multi-cursor would produce a patch
 * wider than necessary, which at worst makes a few more suggestions stale,
 * never a wrong application.
 */
export function diffAsPatch(oldText: string, newText: string): TextPatch | null {
  if (oldText === newText) return null;
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(oldText.length, newText.length) - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }
  return {
    span: { from: prefix, to: oldText.length - suffix },
    before: oldText.slice(prefix, oldText.length - suffix),
    after: newText.slice(prefix, newText.length - suffix),
  };
}
