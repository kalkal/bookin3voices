import { kdpMessageIt, preflightNote } from '../kdpMessages';

describe('kdpMessages', () => {
  it('translates known codes and falls back to the server message for the others', () => {
    expect(kdpMessageIt({ code: 'author_missing', message: 'The book has no author name.' })).toBe(
      'Manca il nome dell’autore.',
    );
    expect(kdpMessageIt({ code: 'new_rule', message: 'Server text.' })).toBe('Server text.');
  });

  it('summarizes the KDP check in Italian', () => {
    expect(preflightNote({})).toBe('');
    expect(preflightNote({ preflight: { errors: [], warnings: [] } })).toBe(
      ' Controllo KDP: tutto a posto.',
    );
    expect(
      preflightNote({
        preflight: {
          errors: [{ code: 'author_missing', message: 'x' }],
          warnings: [{ code: 'cover_missing', message: 'y' }],
        },
      }),
    ).toBe(' Controllo KDP: 1 errore, 1 avviso. Manca il nome dell’autore.');
  });
});
