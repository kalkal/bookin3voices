// Real ExportFileSink: writes the file to the app cache (expo-file-system)
// and opens the system share sheet (expo-sharing) — The file stays
// in cache: no storage permissions, and the system can clean it up on its own.

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { t } from '../../i18n';
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
      throw new Error(t('export.share.unavailable'));
    }
    await Sharing.shareAsync(target.uri, {
      mimeType: file.mimeType,
      dialogTitle: `Condividi ${file.fileName}`,
    });
  }
}
