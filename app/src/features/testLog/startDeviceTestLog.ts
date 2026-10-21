// Starts the test log on the device, once per app run, in dev builds only.
// Never throws: without a writable dir the app simply runs without the log.

import { Platform } from 'react-native';

import appConfig from '../../../app.json';
import { createFileTestLogStore } from './FileTestLogStore';
import { activeTestLogStore, installTestLog, TEST_LOG_ENABLED, type TestLogStore } from './testLog';

export function startDeviceTestLog(): TestLogStore | null {
  if (!TEST_LOG_ENABLED) return null;
  const running = activeTestLogStore();
  if (running !== null) return running;
  try {
    const store = createFileTestLogStore();
    installTestLog(store, {
      // set at build time: EXPO_PUBLIC_BUILD_SHA=$(git rev-parse --short HEAD)
      buildSha: process.env.EXPO_PUBLIC_BUILD_SHA ?? 'unknown',
      appVersion: appConfig.expo.version,
      platform: `${Platform.OS} ${String(Platform.Version)}`,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return store;
  } catch (error) {
    console.warn('test-log-unavailable', error instanceof Error ? error.message : error);
    return null;
  }
}
