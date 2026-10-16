// Chapter text hash (coexistence rule): the client computes it before
// requesting refinement, the function returns it in the suggestions; if on
// return it no longer matches, the suggestions are born stale.
//
// CONTRACT WITH THE refineChapter FUNCTION: the Functions must use EXACTLY this algorithm
// (64-bit FNV-1a over UTF-16 code units, hexadecimal with a version prefix).
// Cryptographic strength is not needed: we only need to notice that the text
// changed, deterministically and identically on both JS sides.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Stable hash of a text, e.g. "v1-cbf29ce484222325". */
export function textHash(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return `v1-${hash.toString(16).padStart(16, '0')}`;
}
