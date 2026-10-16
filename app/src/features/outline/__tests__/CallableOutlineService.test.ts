// La risposta della callable passa da Zod al confine: payload
// conformi passano, payload malformati o mancanti sono errori — mai dati
// "quasi giusti" dentro l'app.

import { CallableOutlineService } from '../CallableOutlineService';

const RISPOSTA_VALIDA = {
  requestId: 'out-1',
  bookId: 'faro',
  model: 'gemini-test',
  promptVersion: 1,
  createdAt: 123,
  chapters: [{ title: 'La secca', summary: 'Riassunto.', beats: ['beat 1', 'beat 2'] }],
};

describe('CallableOutlineService', () => {
  it('valida e restituisce la proposta', async () => {
    const service = new CallableOutlineService({
      call: async () => ({ data: RISPOSTA_VALIDA }),
    });
    const proposal = await service.generateOutline({
      bookId: 'faro',
      synopsis: 'Sinossi di prova.',
      requestId: 'out-1',
    });
    expect(proposal.chapters).toHaveLength(1);
    expect(proposal.chapters[0]?.title).toBe('La secca');
  });

  it('payload malformato → errore (mai dati non validati nella UI)', async () => {
    const service = new CallableOutlineService({
      call: async () => ({ data: { chapters: [{ title: '' }] } }),
    });
    await expect(
      service.generateOutline({ bookId: 'faro', synopsis: 's', requestId: 'r' }),
    ).rejects.toThrow();
  });
});
