import { isAccessCodeRequired } from '../../../lib/callableErrors';
import type { RefineRequest, RefineResult } from '../../review';
import { NO_SAMPLE_BOOK, OfflineSampleSuggestionsProvider, offlineSampleServices } from '..';

const REQUEST: RefineRequest = {
  bookId: 'sample',
  chapterId: 'sample-1',
  text: 'Testo.',
  textHash: 'h',
  requestId: 'ref-1',
  rejected: [],
};

beforeEach(() => jest.spyOn(console, 'info').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('offline sample mode', () => {
  it('refine: the example suggestions when there are some', async () => {
    const example = { textHash: 'h', suggestions: [] } as unknown as RefineResult;
    const provider = new OfflineSampleSuggestionsProvider({ refine: async () => example });
    await expect(provider.refine(REQUEST)).resolves.toBe(example);
  });

  it('refine with no example: the access code error (opens the prompt)', async () => {
    const provider = new OfflineSampleSuggestionsProvider({
      refine: async () => {
        throw new Error('NoExampleAvailableError');
      },
    });
    const error = await provider.refine(REQUEST).catch((e: unknown) => e);
    expect(isAccessCodeRequired(error)).toBe(true);
    // its message is already the plain one (the backup screen shows messages as they are)
    expect((error as Error).message).toMatch(/codice d’accesso.*Devpost/);
  });

  it('outline, export and backup never reach the server: access code error', async () => {
    const services = offlineSampleServices(NO_SAMPLE_BOOK);
    const outcomes = await Promise.all([
      services.outlineService
        .generateOutline({ bookId: 'b', synopsis: 's', requestId: 'o' })
        .catch((e: unknown) => e),
      services.exportService
        .exportBook({ bookId: 'b', format: 'epub', requestId: 'e' })
        .catch((e: unknown) => e),
      services.backupService.exportBackup({ requestId: 'k' }).catch((e: unknown) => e),
      services.suggestionsProvider.refine(REQUEST).catch((e: unknown) => e),
    ]);
    for (const outcome of outcomes) expect(isAccessCodeRequired(outcome)).toBe(true);
    await expect(services.pendingSuggestions.countPending('b')).resolves.toBe(0);
  });
});
