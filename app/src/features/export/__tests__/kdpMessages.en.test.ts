import { setLanguage } from '../../../i18n';
import { preflightNote } from '../kdpMessages';

describe('kdpMessages (English)', () => {
  beforeAll(() => setLanguage('en'));
  afterAll(() => setLanguage('it'));

  it('summarizes the KDP check in English', () => {
    expect(
      preflightNote({
        preflight: {
          errors: [{ code: 'author_missing', message: 'x' }],
          warnings: [{ code: 'cover_missing', message: 'y' }],
        },
      }),
    ).toBe(' KDP check: 1 error, 1 warning. The author name is missing.');
  });
});
