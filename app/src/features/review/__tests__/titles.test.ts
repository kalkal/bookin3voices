import { FirebaseError } from 'firebase/app';

import { CallableTitleRefineService } from '../titles';

const REQUEST = { bookId: 'b', chapterId: 'c', title: 'La piena', requestId: 'tit-1' };

describe('CallableTitleRefineService (errors as values)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the proposals of the callable', async () => {
    const service = new CallableTitleRefineService({
      call: async () => ({ data: { requestId: 'tit-1', model: 'm', proposals: ['Acqua alta'] } }),
    });
    await expect(service.suggestTitles(REQUEST)).resolves.toEqual({
      ok: true,
      proposals: ['Acqua alta'],
    });
  });

  it('a failure is a value with a plain message, logged with the requestId only', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new CallableTitleRefineService({
      call: async () => {
        throw new FirebaseError('functions/internal', 'La piena exploded');
      },
    });
    await expect(service.suggestTitles(REQUEST)).resolves.toEqual({
      ok: false,
      message: 'I titoli non sono arrivati. Riprova tra poco.',
    });
    expect(warn).toHaveBeenCalledWith('callable-failed', {
      action: 'title',
      requestId: 'tit-1',
      code: 'internal',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/piena/);
  });

  it('a malformed answer is a failure value too', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new CallableTitleRefineService({ call: async () => ({ data: { nope: 1 } }) });
    await expect(service.suggestTitles(REQUEST)).resolves.toMatchObject({ ok: false });
  });
});
