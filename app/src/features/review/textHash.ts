// Hash del testo del capitolo (regola di convivenza): il client lo
// calcola prima di chiedere la rifinitura, la function lo restituisce nei
// suggerimenti; se al ritorno non combacia più, i suggerimenti nascono stale.
//
// CONTRATTO CON LA FUNCTION refineChapter: le Functions devono usare ESATTAMENTE questo algoritmo
// (FNV-1a a 64 bit sui code unit UTF-16, esadecimale con prefisso di versione).
// Non serve robustezza crittografica: serve solo accorgersi che il testo è
// cambiato, in modo deterministico e identico sulle due sponde JS.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Hash stabile di un testo, es. "v1-cbf29ce484222325". */
export function textHash(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return `v1-${hash.toString(16).padStart(16, '0')}`;
}
