// The style profile comes from the versioned files in content/ (source of
// truth): this test guarantees the loader finds them and that the content is
// the real one (Rule zero is present), not a placeholder.

import { loadStyleProfileContent } from '../styleProfileContent';

describe('loadStyleProfileContent', () => {
  it('loads the Style Bible and few-shot of the suspense profile', () => {
    const profile = loadStyleProfileContent('suspense');
    expect(profile.styleBible).toContain('Rule zero');
    expect(profile.styleBible).toContain('repetition');
    expect(profile.fewShots).toContain('Example 11');
  });

  it('nonexistent profile → descriptive error', () => {
    expect(() => loadStyleProfileContent('profilo-fantasma')).toThrow('profilo-fantasma');
  });
});
