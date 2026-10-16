// Orchestratore del flusso E2E Maestro su Android.
// Da app/: `npm run e2e:android` (emulatore già avviato, dev client installato).
// Cosa fa: adb reverse 8081 → Metro con EXPO_PUBLIC_E2E=1 → maestro test → cleanup.
//
// Tool paths: by default a "tools" folder next to the repo (or BOOKVOICE_TOOLS); override with
// ANDROID_SDK_ROOT and MAESTRO_BIN to run elsewhere (e.g. CI).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(e2eDir);
const appDir = path.join(repoRoot, 'app');
const isWindows = process.platform === 'win32';

const TOOLS = process.env.BOOKVOICE_TOOLS ?? path.join(repoRoot, '..', 'tools');
const sdkRoot = process.env.ANDROID_SDK_ROOT ?? path.join(TOOLS, 'android', 'sdk');
const adb = path.join(sdkRoot, 'platform-tools', isWindows ? 'adb.exe' : 'adb');
const maestro =
  process.env.MAESTRO_BIN ??
  path.join(TOOLS, 'maestro', 'maestro', 'bin', isWindows ? 'maestro.bat' : 'maestro');

const APP_ID = 'dev.kalkal.bookvoice';
const METRO_PORT = 8081;
// Senza argomenti: TUTTI i flussi della cartella, in sequenza alfabetica
// (dictation-fake → export-epub → review-accept); un singolo yaml come arg.
const flow = process.argv[2] ?? path.join(e2eDir, 'flows');

function fail(message) {
  console.error(`\n[e2e] ${message}`);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.error) fail(`${cmd} non eseguibile: ${result.error.message}`);
  return result;
}

// --- prerequisiti -----------------------------------------------------------
if (!existsSync(adb)) fail(`adb non trovato in ${adb} (imposta ANDROID_SDK_ROOT)`);
if (!existsSync(maestro)) fail(`maestro non trovato in ${maestro} (imposta MAESTRO_BIN)`);

const devices = run(adb, ['devices']).stdout ?? '';
if (!/^\S+\tdevice$/m.test(devices)) {
  fail('nessun emulatore/dispositivo connesso: avvialo prima (vedi e2e/README.md)');
}

const packages = run(adb, ['shell', 'pm', 'list', 'packages', APP_ID]).stdout ?? '';
if (!packages.includes(APP_ID)) {
  fail(`dev client ${APP_ID} non installato: adb install <apk della build EAS development>`);
}

// il deep link del flusso usa localhost:8081 → va rimappato sull'host
run(adb, ['reverse', `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`]);

// --- Metro con la modalità E2E ---------------------------------------------
console.log('[e2e] avvio Metro (EXPO_PUBLIC_E2E=1)...');
const metro = spawn(isWindows ? 'npx.cmd' : 'npx', ['expo', 'start', '--port', `${METRO_PORT}`], {
  cwd: appDir,
  env: { ...process.env, EXPO_PUBLIC_E2E: '1', CI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: isWindows,
});
metro.stdout.on('data', (chunk) => process.stdout.write(`[metro] ${chunk}`));
metro.stderr.on('data', (chunk) => process.stderr.write(`[metro] ${chunk}`));

function stopMetro() {
  if (metro.exitCode !== null) return;
  if (isWindows) spawnSync('taskkill', ['/pid', `${metro.pid}`, '/T', '/F']);
  else metro.kill('SIGTERM');
}
process.on('exit', stopMetro);
process.on('SIGINT', () => process.exit(130));

async function waitForMetro(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (metro.exitCode !== null) fail('Metro è uscito prima di essere pronto');
    try {
      const response = await fetch(`http://localhost:${METRO_PORT}/status`);
      if ((await response.text()).includes('packager-status:running')) return;
    } catch {
      // non ancora in ascolto
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail('Metro non è diventato pronto entro il timeout');
}

await waitForMetro();
console.log('[e2e] Metro pronto, lancio Maestro...');

// --- Maestro ----------------------------------------------------------------
const result = spawnSync(maestro, ['test', flow], {
  stdio: 'inherit',
  shell: isWindows,
  env: { ...process.env, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot },
});

stopMetro();
process.exit(result.status ?? 1);
