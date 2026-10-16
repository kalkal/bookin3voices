// EXACT twin of app/src/features/review/textHash.ts (shared contract):
// 64-bit FNV-1a over UTF-16 code units, 16-digit hex with a version prefix.
// The reference vectors are the same ones pinned in the app's tests; if either
// file changes, the contract changes and both must change TOGETHER.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Versioned hash of the chapter text (coexistence rule). */
export function textHash(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return `v1-${hash.toString(16).padStart(16, '0')}`;
}
