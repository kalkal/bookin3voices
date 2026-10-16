// Esecuzione di EPUBCheck (lo stesso motore usato da Amazon KDP) nel test
// end-to-end dell'export. Gemello di functions/src/__integration__/epubcheck.ts
// (utility di test, duplicata di proposito tra i due package):
//  - EPUBCHECK_JAR: percorso del jar (in CI lo scarica il workflow);
//    default: ./tools/epubcheck/epubcheck.jar (not committed);
//  - JAVA_BIN: eseguibile java; default: JAVA_HOME/bin/java, poi `java` in PATH.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_JAR = join(process.cwd(), 'tools', 'epubcheck', 'epubcheck.jar');

export interface EpubcheckResult {
  status: number | null;
  output: string;
}

function resolveJar(): string {
  const fromEnv = process.env.EPUBCHECK_JAR;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (existsSync(DEFAULT_JAR)) return DEFAULT_JAR;
  throw new Error(
    'EPUBCheck non trovato: impostare EPUBCHECK_JAR (jar di https://github.com/w3c/epubcheck/releases).',
  );
}

function resolveJava(): string {
  const fromEnv = process.env.JAVA_BIN;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const javaHome = process.env.JAVA_HOME;
  if (javaHome !== undefined && javaHome !== '') {
    const candidate = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (existsSync(candidate)) return candidate;
  }
  return 'java';
}

/** Valida un EPUB con EPUBCheck: status 0 = nessun errore né warning. */
export function runEpubcheck(epubPath: string): EpubcheckResult {
  const result = spawnSync(resolveJava(), ['-jar', resolveJar(), epubPath], {
    encoding: 'utf8',
    timeout: 90000,
  });
  if (result.error) {
    throw new Error(`EPUBCheck non eseguibile: ${result.error.message}`);
  }
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}
