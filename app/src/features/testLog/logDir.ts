// Where the test log lives on the device (pure, so it is unit-tested).

export const TEST_LOG_DIR = 'registro-prove';

/** The fallback dir inside the app's documents (internal storage). */
export function internalLogDir(documentUri: string): string {
  return `${documentUri.replace(/\/?$/, '/')}${TEST_LOG_DIR}`;
}

/** adb path of the external dir on Android, from its absolute path. */
export function adbPathOf(absolutePath: string): string {
  return absolutePath.replace(/^\/storage\/emulated\/0\//, '/sdcard/');
}
