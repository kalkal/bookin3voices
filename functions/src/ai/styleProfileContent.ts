// Loads the Style Bible and few-shot examples of a style profile.
//
// SINGLE source of truth: content/style-profiles/<id>/ at the repo root
// (versioned). Firebase deploys only the functions/ folder, so `npm run build`
// copies the profiles into functions/content/ (scripts/copy-style-profiles.mjs,
// a git-ignored folder): at runtime the local copy is tried first, in
// dev/test the loader walks up to the repo. No committed duplicates, no drift.

import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

export interface StyleProfileContent {
  /** Full text of style-bible.md: to be passed as the system instruction. */
  styleBible: string;
  /** Full text of few-shots.md. */
  fewShots: string;
}

/** Candidate roots, in order: the build copy, then the repo (dev and ts-jest). */
function candidateRoots(): string[] {
  return [
    // build:   functions/lib/ai → functions/content
    // ts-jest: functions/src/ai → functions/content (present if the build has already run)
    path.resolve(__dirname, '..', '..', 'content', 'style-profiles'),
    // repo: <root>/content/style-profiles
    path.resolve(__dirname, '..', '..', '..', 'content', 'style-profiles'),
  ];
}

const cache = new Map<string, StyleProfileContent>();

/**
 * Loads the profile (default: suspense). Throws if the profile exists in no
 * root: a clear error beats a prompt without a Style Bible.
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

  throw new Error(`Style profile "${profileId}" not found (style-bible.md missing)`);
}
