// Patch di testo del Command pattern: ogni accettazione/undo è un
// oggetto {span, before, after} con inverso. Regole di convivenza:
// (b) all'applicazione di una patch gli span pending vengono ri-mappati;
// (d) una patch verifica che `before` combaci ancora col testo allo span
//     prima di applicarsi — se no, rifiuto pulito, MAI applicazione cieca.

import type { Span } from './types';

export interface TextPatch {
  span: Span;
  /** Testo atteso allo span (il suggerimento lo chiama `original`). */
  before: string;
  after: string;
}

export type PatchFailure = 'span-out-of-range' | 'original-mismatch';

export type PatchResult = { ok: true; text: string } | { ok: false; reason: PatchFailure };

/** Applica la patch solo se `before` combacia ancora col testo allo span. */
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

/** Patch inversa: applicata dopo l'originale, ripristina il testo (undo). */
export function invertPatch(patch: TextPatch): TextPatch {
  return {
    span: { from: patch.span.from, to: patch.span.from + patch.after.length },
    before: patch.after,
    after: patch.before,
  };
}

/**
 * Ri-mappa uno span dopo l'applicazione di `applied`:
 * - interamente prima della patch → invariato;
 * - interamente dopo → shift del delta di lunghezza;
 * - si sovrappone alla zona patchata → 'overlap': il chiamante lo marca stale.
 * I confini che si toccano senza intersecarsi NON sono sovrapposizione.
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
 * Riduce un edit manuale (testo intero prima/dopo) a UNA patch minima,
 * confrontando prefisso e suffisso comuni. Basta per gli edit di un editor
 * mobile (una zona toccata per volta); un multi-cursore produrrebbe una patch
 * più larga del necessario, che al peggio rende stale qualche suggerimento in
 * più — mai un'applicazione sbagliata.
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
