// Copia content/style-profiles/ (fonte di verità, radice del repo) in
// functions/content/ così che il deploy Firebase — che carica solo la
// cartella functions/ — porti con sé Style Bible e few-shot. La copia è
// ignorata da git (niente doppioni committati); gira dentro `npm run build`.

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
