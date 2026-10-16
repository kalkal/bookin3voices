// Runs EPUBCheck (the same engine used by Amazon KDP) on the files generated
// in the integration tests. Requires Java 11+ and the EPUBCheck jar:
//  - EPUBCHECK_JAR: path to the jar (in CI the workflow downloads it);
//    default: ./tools/epubcheck/epubcheck.jar (not committed);
//  - JAVA_BIN: java executable; default: JAVA_HOME/bin/java, then `java` on PATH.

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
    'EPUBCheck not found: set EPUBCHECK_JAR (jar from https://github.com/w3c/epubcheck/releases).',
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

/** Validates an EPUB with EPUBCheck: status 0 = no errors or warnings. */
export function runEpubcheck(epubPath: string): EpubcheckResult {
  const result = spawnSync(resolveJava(), ['-jar', resolveJar(), epubPath], {
    encoding: 'utf8',
    timeout: 90000,
  });
  if (result.error) {
    throw new Error(`EPUBCheck not executable: ${result.error.message}`);
  }
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}
