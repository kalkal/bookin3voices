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
  it('tutto a posto: ok senza problemi', async () => {
    const report = await runPreflight(checks());
    expect(report).toEqual({ ok: true, issues: [] });
  });

  it('riconoscimento non disponibile: blocker, senza chiedere permessi', async () => {
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

  it('permesso mancante: lo chiede una volta e se concesso è ok', async () => {
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

  it('permesso negato per sempre: blocker con azione "apri impostazioni"', async () => {
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

  it('italiano offline non installato (Android): warning ma si può dettare', async () => {
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

  it('confronto lingue robusto su maiuscole e underscore (it_IT)', async () => {
    const report = await runPreflight(
      checks({
        getSupportedLocales: async () => ({ locales: ['it_IT'], installedLocales: ['it_IT'] }),
      }),
    );
    expect(report.issues).toEqual([]);
  });

  it('lista lingue vuota (Android ≤12) o servizio muto: nessun falso allarme', async () => {
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

  it('su iOS il controllo del pacchetto offline non si applica', async () => {
    const getSupportedLocales = jest.fn();
    const report = await runPreflight(checks({ platform: 'ios', getSupportedLocales }));
    expect(report.ok).toBe(true);
    expect(getSupportedLocales).not.toHaveBeenCalled();
  });
});
