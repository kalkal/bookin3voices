// The callable's response goes through Zod at the boundary: conforming
// payloads pass, malformed or missing payloads are errors — never "almost
// right" data inside the app.

import { CallableOutlineService } from '../CallableOutlineService';

const RISPOSTA_VALIDA = {
  requestId: 'out-1',
  bookId: 'mulino',
  model: 'amazon.nova-pro-v1:0',
  promptVersion: 1,
  createdAt: 123,
  chapters: [{ title: 'La gola chiusa', summary: 'Riassunto.', beats: ['beat 1', 'beat 2'] }],
};

describe('CallableOutlineService', () => {
  it('validates and returns the proposal', async () => {
    const service = new CallableOutlineService({
      call: async () => ({ data: RISPOSTA_VALIDA }),
    });
    const proposal = await service.generateOutline({
      bookId: 'mulino',
      synopsis: 'Sinossi di prova.',
      requestId: 'out-1',
    });
    expect(proposal.chapters).toHaveLength(1);
    expect(proposal.chapters[0]?.title).toBe('La gola chiusa');
  });

  it('malformed payload → error (never unvalidated data in the UI)', async () => {
    const service = new CallableOutlineService({
      call: async () => ({ data: { chapters: [{ title: '' }] } }),
    });
    await expect(
      service.generateOutline({ bookId: 'mulino', synopsis: 's', requestId: 'r' }),
    ).rejects.toThrow();
  });
});
