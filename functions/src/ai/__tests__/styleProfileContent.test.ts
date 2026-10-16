// Il profilo di stile arriva dai file versionati in content/ (fonte di
// verità): questo test garantisce che il loader li trovi e che il contenuto
// sia quello vero (la Regola zero c'è), non un segnaposto.

import { loadStyleProfileContent } from '../styleProfileContent';

describe('loadStyleProfileContent', () => {
  it('carica la Style Bible e i few-shot del profilo suspense', () => {
    const profile = loadStyleProfileContent('suspense');
    expect(profile.styleBible).toContain('Rule zero');
    expect(profile.styleBible).toContain('repetition');
    expect(profile.fewShots).toContain('Example 11');
  });

  it('profilo inesistente → errore parlante', () => {
    expect(() => loadStyleProfileContent('profilo-fantasma')).toThrow('profilo-fantasma');
  });
});
