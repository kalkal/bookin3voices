// Test log files on the device.
//
// Android: the app's EXTERNAL files dir, through the local native module
// modules/test-log-dir (getExternalFilesDir), so the log can be fetched with
// no permission and no root:
//   adb pull /sdcard/Android/data/dev.kalkal.bookvoice/files/registro-prove/
// expo-file-system cannot create that dir (it writes outside the sandbox only
// into paths that already exist), hence the module.
// Fallback (module missing, iOS, unusual devices): the internal documents dir
// (`files/registro-prove/`, readable with `adb shell run-as
// dev.kalkal.bookvoice` on debuggable builds). The header line records the
// location actually used.

import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';

import { adbPathOf, internalLogDir, TEST_LOG_DIR } from './logDir';
import { RotatingLogStore, type LogFileOps } from './testLog';

/** modules/test-log-dir (Android only). */
interface TestLogDirModule {
  directory(name: string): string;
  append(path: string, text: string): void;
  size(path: string): number;
  read(path: string): string;
  list(path: string): string[];
}

class NativeFileOps implements LogFileOps {
  constructor(
    private readonly native: TestLogDirModule,
    private readonly dir: string,
  ) {}

  get location(): string {
    return adbPathOf(this.dir);
  }

  private path(name: string): string {
    return `${this.dir}/${name}`;
  }

  size(name: string): number {
    return this.native.size(this.path(name));
  }

  append(name: string, text: string): void {
    this.native.append(this.path(name), text);
  }

  read(name: string): string {
    return this.native.read(this.path(name));
  }

  list(): string[] {
    return this.native.list(this.dir);
  }
}

class DirectoryFileOps implements LogFileOps {
  constructor(private readonly dir: Directory) {}

  get location(): string {
    return this.dir.uri;
  }

  size(name: string): number {
    const file = new File(this.dir, name);
    return file.exists ? (file.size ?? 0) : 0;
  }

  append(name: string, text: string): void {
    const file = new File(this.dir, name);
    if (!file.exists) file.create();
    file.write(text, { append: true });
  }

  read(name: string): string {
    const file = new File(this.dir, name);
    return file.exists ? file.textSync() : '';
  }

  list(): string[] {
    return this.dir
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => file.name);
  }
}

function openFileOps(): LogFileOps {
  const native = requireOptionalNativeModule<TestLogDirModule>('TestLogDir');
  if (native !== null) {
    try {
      return new NativeFileOps(native, native.directory(TEST_LOG_DIR));
    } catch (error) {
      console.warn('test-log-external-dir-failed', error instanceof Error ? error.message : error);
    }
  }
  const dir = new Directory(internalLogDir(Paths.document.uri));
  dir.create({ intermediates: true, idempotent: true });
  return new DirectoryFileOps(dir);
}

/** The device store; throws when no directory is writable (the caller runs without it). */
export function createFileTestLogStore(): RotatingLogStore {
  return new RotatingLogStore(openFileOps());
}
