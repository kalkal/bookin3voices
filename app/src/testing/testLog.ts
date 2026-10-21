// Captures the dev test log in memory, for the tests of the logging hooks.

import { installTestLog, type TestLogStore } from '../features/testLog';

export function captureTestLog(): { events: (type?: string) => Record<string, unknown>[] } {
  const lines: string[] = [];
  const store: TestLogStore = {
    location: 'mem://test-log',
    append: (line) => lines.push(line),
    read: () => lines.join(''),
  };
  installTestLog(store, { buildSha: 'test', appVersion: '0', platform: 'jest', timeZone: 'UTC' });
  return {
    events: (type) =>
      lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((event) => type === undefined || event.type === type),
  };
}
