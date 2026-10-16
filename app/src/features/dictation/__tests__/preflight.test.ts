import { runPreflight, type PreflightChecks } from '../preflight';

function checks(overrides: Partial<PreflightChecks> = {}): PreflightChecks {
  return {
    isRecognitionAvailable: () => true,
    getPermissions: async () => ({ granted: true, canAskAgain: true }),
    requestPermissions: async () => ({ granted: true, canAskAgain: true }),
    getSupportedLocales: async () => ({
      locales: ['it-IT', 'en-US'],
      installedLocales: ['it-IT'],
    }),
    platform: 'android',
    ...overrides,
  };
}

describe('runPreflight', () => {
  it('all fine: ok with no issues', async () => {
    const report = await runPreflight(checks());
    expect(report).toEqual({ ok: true, issues: [] });
  });

  it('recognition unavailable: blocker, without asking for permissions', async () => {
    const requestPermissions = jest.fn();
    const report = await runPreflight(
      checks({ isRecognitionAvailable: () => false, requestPermissions }),
    );
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({ id: 'recognition-unavailable', severity: 'blocker' }),
    ]);
    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('permission missing: asks once and if granted it is ok', async () => {
    let granted = false;
    const report = await runPreflight(
      checks({
        getPermissions: async () => ({ granted: false, canAskAgain: true }),
        requestPermissions: async () => {
          granted = true;
          return { granted, canAskAgain: true };
        },
      }),
    );
    expect(report.ok).toBe(true);
    expect(granted).toBe(true);
  });

  it('permission denied permanently: blocker with the "open settings" action', async () => {
    const report = await runPreflight(
      checks({
        getPermissions: async () => ({ granted: false, canAskAgain: false }),
        requestPermissions: async () => ({ granted: false, canAskAgain: false }),
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      expect.objectContaining({
        id: 'permission-denied',
        severity: 'blocker',
        action: 'open-settings',
      }),
    ]);
  });

  it('offline Italian not installed (Android): warning but dictation is possible', async () => {
    const report = await runPreflight(
      checks({
        getSupportedLocales: async () => ({
          locales: ['it-IT', 'en-US'],
          installedLocales: ['en-US'],
        }),
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([
      expect.objectContaining({
        id: 'offline-language-missing',
        severity: 'warning',
        action: 'download-offline-model',
      }),
    ]);
  });

  it('language comparison robust to case and underscore (it_IT)', async () => {
    const report = await runPreflight(
      checks({
        getSupportedLocales: async () => ({ locales: ['it_IT'], installedLocales: ['it_IT'] }),
      }),
    );
    expect(report.issues).toEqual([]);
  });

  it('empty language list (Android ≤12) or silent service: no false alarm', async () => {
    const vuota = await runPreflight(
      checks({ getSupportedLocales: async () => ({ locales: [], installedLocales: [] }) }),
    );
    expect(vuota.issues).toEqual([]);
    const rotta = await runPreflight(
      checks({
        getSupportedLocales: async () => {
          throw new Error('package_not_found');
        },
      }),
    );
    expect(rotta).toEqual({ ok: true, issues: [] });
  });

  it('on iOS the offline pack check does not apply', async () => {
    const getSupportedLocales = jest.fn();
    const report = await runPreflight(checks({ platform: 'ios', getSupportedLocales }));
    expect(report.ok).toBe(true);
    expect(getSupportedLocales).not.toHaveBeenCalled();
  });
});
