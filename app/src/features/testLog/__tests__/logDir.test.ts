// The internal fallback dir and the adb path shown to the reader.

import { adbPathOf, internalLogDir } from '../logDir';

describe('test log dir', () => {
  it('builds the internal fallback under the documents dir', () => {
    expect(internalLogDir('file:///data/user/0/dev.kalkal.bookvoice/files/')).toBe(
      'file:///data/user/0/dev.kalkal.bookvoice/files/registro-prove',
    );
    expect(internalLogDir('file:///var/app/Documents')).toBe(
      'file:///var/app/Documents/registro-prove',
    );
  });

  it('turns the external dir into the path adb pulls', () => {
    expect(
      adbPathOf('/storage/emulated/0/Android/data/dev.kalkal.bookvoice/files/registro-prove'),
    ).toBe('/sdcard/Android/data/dev.kalkal.bookvoice/files/registro-prove');
  });
});
