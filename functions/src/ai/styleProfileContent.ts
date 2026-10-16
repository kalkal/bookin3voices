// Caricamento della Style Bible e dei few-shot di un profilo di stile.
//
// Fonte di verità UNICA: content/style-profiles/<id>/ nella radice del repo
// (versionata). Al deploy Firebase carica solo la
// cartella functions/, quindi `npm run build` copia i profili in
// functions/content/ (scripts/copy-style-profiles.mjs, cartella ignorata da
// git): a runtime si prova prima la copia locale, in dev/test si risale al
// repo. Niente doppioni committati, niente drift.

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface StyleProfileContent {
  /** Testo integrale di style-bible.md: va passato come system instruction. */
  styleBible: string;
  /** Testo integrale di few-shots.md. */
  fewShots: string;
}

/** Radici candidate, in ordine: copia di build, poi il repo (dev e ts-jest). */
function candidateRoots(): string[] {
  return [
    // build:   functions/lib/ai → functions/content
    // ts-jest: functions/src/ai → functions/content (presente se build già girata)
    path.resolve(__dirname, '..', '..', 'content', 'style-profiles'),
    // repo: <root>/content/style-profiles
    path.resolve(__dirname, '..', '..', '..', 'content', 'style-profiles'),
  ];
}

const cache = new Map<string, StyleProfileContent>();

/**
 * Carica il profilo (default: suspense). Lancia se il profilo non esiste
 * in nessuna radice: meglio un errore chiaro di un prompt senza Style Bible.
 */
export function loadStyleProfileContent(profileId = 'suspense'): StyleProfileContent {
  const cached = cache.get(profileId);
  if (cached !== undefined) return cached;

  for (const root of candidateRoots()) {
    const dir = path.join(root, profileId);
    if (!existsSync(path.join(dir, 'style-bible.md'))) continue;
    const content: StyleProfileContent = {
      styleBible: readFileSync(path.join(dir, 'style-bible.md'), 'utf8'),
      fewShots: readFileSync(path.join(dir, 'few-shots.md'), 'utf8'),
    };
    cache.set(profileId, content);
    return content;
  }

  throw new Error(`Profilo di stile "${profileId}" non trovato (style-bible.md mancante)`);
}
