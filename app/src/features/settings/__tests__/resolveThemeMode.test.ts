import { resolveThemeMode } from '../useSettingsController';

describe('resolveThemeMode', () => {
  it('le preferenze esplicite passano dritte al ThemeProvider', () => {
    expect(resolveThemeMode('paper', 'dark')).toBe('paper');
    expect(resolveThemeMode('candlelight', 'light')).toBe('candlelight');
  });

  it('"automatico" segue il tema di sistema', () => {
    expect(resolveThemeMode('auto', 'dark')).toBe('candlelight');
    expect(resolveThemeMode('auto', 'light')).toBe('paper');
  });

  it('"automatico" senza informazione di sistema cade sulla carta (default dell\'app)', () => {
    expect(resolveThemeMode('auto', null)).toBe('paper');
    expect(resolveThemeMode('auto', undefined)).toBe('paper');
  });
});
