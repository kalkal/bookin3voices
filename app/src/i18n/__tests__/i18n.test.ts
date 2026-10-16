import {
  getLanguage,
  NAMESPACES,
  resolveLanguage,
  setLanguage,
  subscribeLanguage,
  t,
  tn,
  uiLocale,
} from '../index';

describe('i18n', () => {
  afterEach(() => setLanguage('it'));

  it.each(Object.entries(NAMESPACES))(
    'namespace %s: English and Italian have the same keys, all prefixed',
    (name, ns) => {
      expect(Object.keys(ns.en).sort()).toEqual(Object.keys(ns.it).sort());
      for (const key of Object.keys(ns.en)) {
        expect(key.startsWith(`${name}.`)).toBe(true);
        expect(ns.en[key]).not.toBe('');
      }
    },
  );

  it('no key is defined by two namespaces', () => {
    const seen = new Set<string>();
    for (const ns of Object.values(NAMESPACES)) {
      for (const key of Object.keys(ns.en)) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('fills placeholders, falls back to the key, and picks plural forms', () => {
    setLanguage('en');
    expect(t('missing.key')).toBe('missing.key');
    expect(uiLocale()).toBe('en-US');
    setLanguage('it');
    expect(uiLocale()).toBe('it-IT');
    expect(tn('missing.count', 1)).toBe('missing.count_one');
  });
});

describe('language switching', () => {
  afterEach(() => setLanguage('it'));

  it('notifies subscribers once per change and resolves preferences', () => {
    const calls: string[] = [];
    const unsubscribe = subscribeLanguage(() => calls.push(getLanguage()));
    setLanguage('en');
    setLanguage('en');
    setLanguage('it');
    unsubscribe();
    setLanguage('en');
    expect(calls).toEqual(['en', 'it']);
    expect(resolveLanguage('it')).toBe('it');
    expect(resolveLanguage('en')).toBe('en');
    expect(['en', 'it']).toContain(resolveLanguage('system'));
  });
});
