import { CallableBookExportService } from '../CallableBookExportService';
import type { ExportRequest } from '../types';

const REQUEST: ExportRequest = { bookId: 'faro', format: 'epub', requestId: 'req-1' };

const VALID_RESPONSE = {
  exportId: 'req-1',
  format: 'epub',
  fileName: 'il-faro.epub',
  mimeType: 'application/epub+zip',
  base64: 'ZmludG8=',
  size: 5,
  createdAt: 1757150000000,
};

describe('CallableBookExportService', () => {
  it('passa la richiesta alla callable e valida la risposta con Zod', async () => {
    const call = jest.fn().mockResolvedValue({ data: VALID_RESPONSE });
    const service = new CallableBookExportService({ call });

    const file = await service.exportBook(REQUEST);

    expect(call).toHaveBeenCalledWith(REQUEST);
    expect(file).toEqual(VALID_RESPONSE);
  });

  it('rifiuta risposte malformate (parse, don’t validate al confine)', async () => {
    const call = jest.fn().mockResolvedValue({ data: { ...VALID_RESPONSE, base64: '' } });
    const service = new CallableBookExportService({ call });

    await expect(service.exportBook(REQUEST)).rejects.toThrow();
  });
});
