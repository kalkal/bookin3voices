import { setLanguage } from '../../../i18n';
import { KIND_LABELS } from '../types';

describe('KIND_LABELS (English)', () => {
  beforeAll(() => setLanguage('en'));
  afterAll(() => setLanguage('it'));

  it('follows the UI language at read time', () => {
    expect(KIND_LABELS.grammar).toBe('Grammar');
    expect(KIND_LABELS.history).toBe('History');
  });
});
