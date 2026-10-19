import { setLanguage } from '../../../i18n';
import { commandLanguage, dictationLocale } from '../dictationLanguage';

describe('dictationLocale — the recognition language of a dictation', () => {
  afterEach(() => setLanguage('it'));

  it('maps the app languages to a BCP-47 locale', () => {
    expect(dictationLocale('it')).toBe('it-IT');
    expect(dictationLocale('en')).toBe('en-US');
  });

  it('keeps an explicit region and ignores letter case and "_"', () => {
    expect(dictationLocale('en-GB')).toBe('en-GB');
    expect(dictationLocale('EN_au')).toBe('en-AU');
    expect(dictationLocale(' it-IT ')).toBe('it-IT');
  });

  it('accepts the names typed in the free-text language field', () => {
    expect(dictationLocale('Italiano')).toBe('it-IT');
    expect(dictationLocale('ita')).toBe('it-IT');
    expect(dictationLocale('English')).toBe('en-US');
    expect(dictationLocale('eng')).toBe('en-US');
  });

  it('with no usable book language follows the interface language', () => {
    setLanguage('en');
    expect(dictationLocale(undefined)).toBe('en-US');
    expect(dictationLocale('')).toBe('en-US');
    expect(dictationLocale('fr')).toBe('en-US');
    setLanguage('it');
    expect(dictationLocale(undefined)).toBe('it-IT');
    expect(dictationLocale('   ')).toBe('it-IT');
  });
});

describe('commandLanguage — which spoken commands apply', () => {
  it('derives the command language from the locale', () => {
    expect(commandLanguage('it-IT')).toBe('it');
    expect(commandLanguage('en-GB')).toBe('en');
    expect(commandLanguage('en-US')).toBe('en');
  });
});

describe('dictationLocale — more free-text values', () => {
  it('maps the common "UK" to the GB region', () => {
    expect(dictationLocale('en-UK')).toBe('en-GB');
  });

  it('reads the language from the first word of a longer name', () => {
    expect(dictationLocale('Italian (Italy)')).toBe('it-IT');
    expect(dictationLocale('English (UK)')).toBe('en-US');
  });
});
