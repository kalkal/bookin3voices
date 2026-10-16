import { useSyncExternalStore } from 'react';

import { getLanguage, subscribeLanguage, type Lang } from './index';

/** Current UI language; the component re-renders when it changes. */
export function useLanguage(): Lang {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}
