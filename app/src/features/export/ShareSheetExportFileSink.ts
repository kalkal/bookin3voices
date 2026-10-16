// ExportFileSink reale: scrive il file nella cache dell'app (expo-file-system)
// e apre lo share sheet di sistema (expo-sharing) — Il file resta
// in cache: niente permessi di storage, e il sistema può ripulirla da sé.

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { base64ToUint8Array } from './base64';
import type { ExportFileSink, ShareableFile } from './types';

export class ShareSheetExportFileSink implements ExportFileSink {
  async saveAndShare(file: ShareableFile): Promise<void> {
    const target = new File(Paths.cache, file.fileName);
    if (target.exists) {
      target.delete();
    }
    target.write(base64ToUint8Array(file.base64));

    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('La condivisione non è disponibile su questo dispositivo.');
    }
    await Sharing.shareAsync(target.uri, {
      mimeType: file.mimeType,
      dialogTitle: `Condividi ${file.fileName}`,
    });
  }
}
