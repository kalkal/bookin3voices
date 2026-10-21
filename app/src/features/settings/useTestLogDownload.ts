// «Scarica registro» (dev builds only): today's test log, saved and shared
// through the same file sink as the backup and the export.

import { useCallback, useState } from 'react';

import { t } from '../../i18n';
import { utf8ToBase64 } from '../export';
import type { ExportFileSink } from '../export';
import type { TestLogStore } from '../testLog';

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function useTestLogDownload(store: TestLogStore | undefined, fileSink: ExportFileSink) {
  const [message, setMessage] = useState('');

  const download = useCallback(() => {
    if (store === undefined) return;
    void (async () => {
      const fileName = `registro-prove-${today()}.jsonl`;
      try {
        await fileSink.saveAndShare({
          fileName,
          mimeType: 'text/plain',
          base64: utf8ToBase64(store.read()),
        });
        setMessage(t('settings.testLog.done', { fileName }));
      } catch (error) {
        console.warn('test-log-download-failed', {
          error: error instanceof Error ? error.name : typeof error,
        });
        setMessage(t('settings.testLog.error'));
      }
    })();
  }, [store, fileSink]);

  return { message, download };
}
