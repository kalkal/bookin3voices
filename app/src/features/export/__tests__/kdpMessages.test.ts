import { kdpMessageIt, preflightNote } from '../kdpMessages';

describe('kdpMessages', () => {
  it('traduce i codici noti e ripiega sul messaggio del server per gli altri', () => {
    expect(kdpMessageIt({ code: 'author_missing', message: 'The book has no author name.' })).toBe(
      'Manca il nome dell’autore.',
    );
    expect(kdpMessageIt({ code: 'new_rule', message: 'Server text.' })).toBe('Server text.');
  });

  it('riepiloga il controllo KDP in italiano', () => {
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
