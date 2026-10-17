import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import { InMemoryBookRepository } from '../../books';
import { ExportTab } from '../ExportTab';
import {
  InMemoryBookExportService,
  InMemoryExportFileSink,
  InMemoryPendingSuggestionsRepository,
} from '../inMemory';
import type { BookExportService } from '../types';

function setup(options?: {
  pending?: number;
  exportService?: BookExportService;
  waitForSync?: () => Promise<boolean>;
}) {
  const books = new InMemoryBookRepository();
  const book = books.seed({
    id: 'faro',
    title: 'Il faro di Levante',
    author: 'Jane Doe',
    description: 'Un faro, un segreto.',
    language: 'it',
  });
  const exportService = options?.exportService ?? new InMemoryBookExportService();
  const pendingSuggestions = new InMemoryPendingSuggestionsRepository(options?.pending ?? 0);
  const fileSink = new InMemoryExportFileSink();
  const result = render(
    <ThemeProvider>
      <ExportTab
        book={book}
        bookRepository={books}
        exportService={exportService}
        pendingSuggestions={pendingSuggestions}
        fileSink={fileSink}
        waitForSync={options?.waitForSync}
      />
    </ThemeProvider>,
  );
  return { result, books, exportService, fileSink };
}

describe('ExportTab', () => {
  it("shows the book's KDP metadata and saves them after editing", async () => {
    const { result, books } = setup();
    const screen = await result;

    expect(await screen.findByTestId('export-title')).toHaveProp('value', 'Il faro di Levante');
    expect(screen.getByTestId('export-author')).toHaveProp('value', 'Jane Doe');

    await fireEvent.changeText(screen.getByTestId('export-author'), 'J. Doe');
    await fireEvent.changeText(screen.getByTestId('export-description'), 'Nuova descrizione.');
    await fireEvent.press(screen.getByTestId('export-save-metadata'));

    await waitFor(async () => {
      const saved = await books.getBook('faro');
      expect(saved).toMatchObject({ author: 'J. Doe', description: 'Nuova descrizione.' });
    });
    expect(await screen.findByTestId('export-metadata-saved')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('with no pending suggestions it shows no warnings', async () => {
    const { result } = setup({ pending: 0 });
    const screen = await result;
    await screen.findByTestId('export-tab');
    expect(screen.queryByTestId('export-pending-warning')).toBeNull();
    await screen.unmount();
  });

  it('warns if there are pending suggestions', async () => {
    const { result } = setup({ pending: 3 });
    const screen = await result;
    const warning = await screen.findByTestId('export-pending-warning');
    expect(warning).toHaveTextContent(/3 suggerimenti in sospeso/);
    expect(warning).toHaveTextContent(/li ignora/);
    await screen.unmount();
  });

  it('generates in the chosen format, saves and shares, then shows the outcome', async () => {
    const { result, exportService, fileSink } = setup();
    const screen = await result;
    const service = exportService as InMemoryBookExportService;

    await fireEvent.press(await screen.findByTestId('export-format-docx'));
    await fireEvent.press(screen.getByTestId('export-generate'));

    await waitFor(() => expect(fileSink.shared).toHaveLength(1));
    expect(service.requests[0]).toMatchObject({ bookId: 'faro', format: 'docx' });
    expect(service.requests[0]?.requestId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(fileSink.shared[0]?.fileName).toBe('libro.docx');
    expect(await screen.findByTestId('export-status')).toHaveTextContent(/libro\.docx.*generato/);
    await screen.unmount();
  });

  it('a callable error becomes a readable message', async () => {
    const failing: BookExportService = {
      exportBook: async () => {
        throw new Error('Il libro non ha capitoli da esportare.');
      },
    };
    const { result } = setup({ exportService: failing });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('export-generate'));
    expect(await screen.findByTestId('export-status')).toHaveTextContent(
      'Il libro non ha capitoli da esportare.',
    );
    await screen.unmount();
  });

  it('waits for local writes to be synced before calling the export', async () => {
    const order: string[] = [];
    let release: (synced: boolean) => void = () => {};
    const waitForSync = () =>
      new Promise<boolean>((resolve) => {
        order.push('sync-started');
        release = (synced) => {
          order.push('sync-done');
          resolve(synced);
        };
      });
    const service = new InMemoryBookExportService();
    const original = service.exportBook.bind(service);
    service.exportBook = async (request) => {
      order.push('export');
      return original(request);
    };
    const { result, fileSink } = setup({ exportService: service, waitForSync });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('export-generate'));
    await waitFor(() => expect(order).toEqual(['sync-started']));
    release(true);
    await waitFor(() => expect(fileSink.shared).toHaveLength(1));
    expect(order).toEqual(['sync-started', 'sync-done', 'export']);
    expect(await screen.findByTestId('export-status')).not.toHaveTextContent(/non ancora sincron/);
    await screen.unmount();
  });

  it('if the sync times out it still exports and warns that changes may be missing', async () => {
    const { result, fileSink } = setup({ waitForSync: async () => false });
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('export-generate'));
    await waitFor(() => expect(fileSink.shared).toHaveLength(1));
    expect(await screen.findByTestId('export-status')).toHaveTextContent(
      /non ancora sincronizzate/,
    );
    await screen.unmount();
  });
});
