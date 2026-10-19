import { resolveThemeMode } from '../useSettingsController';

describe('resolveThemeMode', () => {
  it('explicit preferences pass straight to the ThemeProvider', () => {
    expect(resolveThemeMode('paper', 'dark')).toBe('paper');
    expect(resolveThemeMode('candlelight', 'light')).toBe('candlelight');
  });

  it('"automatic" follows the system theme', () => {
    expect(resolveThemeMode('auto', 'dark')).toBe('candlelight');
    expect(resolveThemeMode('auto', 'light')).toBe('paper');
  });

  it('"automatic" without system information falls back to black and gold (the app default)', () => {
    expect(resolveThemeMode('auto', null)).toBe('candlelight');
    expect(resolveThemeMode('auto', undefined)).toBe('candlelight');
    expect(resolveThemeMode('auto', 'unspecified')).toBe('candlelight');
  });
});
