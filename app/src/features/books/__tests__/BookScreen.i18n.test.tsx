import { render } from '@testing-library/react-native';

import { setLanguage } from '../../../i18n';
import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import {
  InMemoryBookExportService,
  InMemoryExportFileSink,
  InMemoryPendingSuggestionsRepository,
} from '../../export';
import { InMemoryOutlineService } from '../../outline';
import { BookScreen } from '../BookScreen';
import { InMemoryBookRepository } from '../InMemoryBookRepository';

describe('BookScreen in English', () => {
  afterEach(() => setLanguage('it'));

  it('shows English labels and number formatting', async () => {
    setLanguage('en');
    const books = new InMemoryBookRepository();
    books.seed({ id: 'faro', title: 'The Lighthouse', wordCount: 24_310, chapterCount: 9 });
    const screen = await render(
      <ThemeProvider>
        <BookScreen
          bookId="faro"
          bookRepository={books}
          chapterRepository={new InMemoryChapterRepository()}
          exportService={new InMemoryBookExportService()}
          pendingSuggestions={new InMemoryPendingSuggestionsRepository()}
          exportFileSink={new InMemoryExportFileSink()}
          outlineService={new InMemoryOutlineService()}
          onBack={jest.fn()}
          onOpenChapter={jest.fn()}
          onDictateChapter={jest.fn()}
        />
      </ThemeProvider>,
    );
    expect(await screen.findByText(/24,310 words · 9 chapters/)).toBeOnTheScreen();
    expect(screen.getByText('New chapter')).toBeOnTheScreen();
  });
});
