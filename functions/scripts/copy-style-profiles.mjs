// Copies content/style-profiles/ (source of truth, repo root) into
// functions/content/ so that the Firebase deploy — which uploads only the
// functions/ folder — carries the Style Bible and few-shots with it. The copy
// is ignored by git (no committed duplicates); it runs inside `npm run build`.

import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const functionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(functionsDir, '..', 'content', 'style-profiles');
const target = path.resolve(functionsDir, 'content', 'style-profiles');

if (!existsSync(source)) {
  console.error(`copy-style-profiles: sorgente mancante: ${source}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(path.dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log('copy-style-profiles: content/style-profiles → functions/content/style-profiles');
