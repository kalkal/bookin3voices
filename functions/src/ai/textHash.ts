// Gemello ESATTO di app/src/features/review/textHash.ts (contratto condiviso):
// FNV-1a a 64 bit sui code unit UTF-16, hex su 16 cifre con prefisso di
// versione. I vettori di riferimento sono gli stessi pinnati nei test
// dell'app — se uno dei due file cambia, cambia il contratto e devono
// cambiare INSIEME.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Hash versionato del testo del capitolo (regola di convivenza). */
export function textHash(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return `v1-${hash.toString(16).padStart(16, '0')}`;
}
