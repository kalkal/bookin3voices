// Repository errors follow the UI language too.

import { setLanguage } from '../../../i18n';
import { InMemoryChapterRepository } from '../InMemoryChapterRepository';

describe('chapter repository errors in English', () => {
  afterEach(() => setLanguage('it'));

  it('reorder with mismatching ids fails with the English message', async () => {
    setLanguage('en');
    const repo = new InMemoryChapterRepository();
    await expect(repo.reorderChapters('b', ['x'])).rejects.toThrow('Incomplete reorder');
  });
});
