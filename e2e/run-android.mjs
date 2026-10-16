// Orchestrator of the Maestro E2E flow on Android.
// From app/: `npm run e2e:android` (emulator already started, dev client installed).
// What it does: adb reverse 8081 → Metro with EXPO_PUBLIC_E2E=1 → maestro test → cleanup.
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
// Without arguments: ALL the flows in the folder, in alphabetical order
// (dictation-fake → export-epub → review-accept); a single yaml as argument.
const flow = process.argv[2] ?? path.join(e2eDir, 'flows');

function fail(message) {
  console.error(`\n[e2e] ${message}`);
  process.exit(1);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (result.error) fail(`${cmd} cannot be run: ${result.error.message}`);
  return result;
}

// --- prerequisiti -----------------------------------------------------------
if (!existsSync(adb)) fail(`adb not found at ${adb} (set ANDROID_SDK_ROOT)`);
if (!existsSync(maestro)) fail(`maestro not found at ${maestro} (set MAESTRO_BIN)`);

const devices = run(adb, ['devices']).stdout ?? '';
if (!/^\S+\tdevice$/m.test(devices)) {
  fail('no emulator/device connected: start one first (see e2e/README.md)');
}

const packages = run(adb, ['shell', 'pm', 'list', 'packages', APP_ID]).stdout ?? '';
if (!packages.includes(APP_ID)) {
  fail(`dev client ${APP_ID} not installed: adb install <apk of the EAS development build>`);
}

// the flow's deep link uses localhost:8081 → it must be remapped to the host
run(adb, ['reverse', `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`]);

// --- Metro with E2E mode ---------------------------------------------------
console.log('[e2e] starting Metro (EXPO_PUBLIC_E2E=1, Italian UI)...');
const metro = spawn(isWindows ? 'npx.cmd' : 'npx', ['expo', 'start', '--port', `${METRO_PORT}`], {
  cwd: appDir,
  // the flows match the Italian UI text, so force the Italian interface
  env: { ...process.env, EXPO_PUBLIC_E2E: '1', EXPO_PUBLIC_UI_LANG: 'it', CI: '1' },
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
    if (metro.exitCode !== null) fail('Metro exited before being ready');
    try {
      const response = await fetch(`http://localhost:${METRO_PORT}/status`);
      if ((await response.text()).includes('packager-status:running')) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail('Metro did not become ready within the timeout');
}

await waitForMetro();
console.log('[e2e] Metro ready, launching Maestro...');

// --- Maestro ----------------------------------------------------------------
const result = spawnSync(maestro, ['test', flow], {
  stdio: 'inherit',
  shell: isWindows,
  env: { ...process.env, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot },
});

stopMetro();
process.exit(result.status ?? 1);
