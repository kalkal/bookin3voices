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

function setup(options?: { pending?: number; exportService?: BookExportService }) {
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
      />
    </ThemeProvider>,
  );
  return { result, books, exportService, fileSink };
}

describe('ExportTab', () => {
  it('mostra i metadati KDP del libro e li salva modificati', async () => {
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

  it('senza suggerimenti pending non mostra avvisi', async () => {
    const { result } = setup({ pending: 0 });
    const screen = await result;
    await screen.findByTestId('export-tab');
    expect(screen.queryByTestId('export-pending-warning')).toBeNull();
    await screen.unmount();
  });

  it('avvisa se ci sono suggerimenti pending', async () => {
    const { result } = setup({ pending: 3 });
    const screen = await result;
    const warning = await screen.findByTestId('export-pending-warning');
    expect(warning).toHaveTextContent(/3 suggerimenti in sospeso/);
    expect(warning).toHaveTextContent(/li ignora/);
    await screen.unmount();
  });

  it('genera nel formato scelto, salva e condivide, poi mostra l’esito', async () => {
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

  it('un errore della callable diventa un messaggio leggibile', async () => {
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
});
