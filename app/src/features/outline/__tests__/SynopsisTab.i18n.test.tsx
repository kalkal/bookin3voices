import { render } from '@testing-library/react-native';

import { setLanguage } from '../../../i18n';
import { ThemeProvider } from '../../../theme';
import { InMemoryBookRepository } from '../../books';
import { InMemoryChapterRepository } from '../../chapters';
import { InMemoryOutlineService } from '../inMemory';
import { SynopsisTab } from '../SynopsisTab';

describe('SynopsisTab in English', () => {
  afterEach(() => setLanguage('it'));

  it('shows English labels', async () => {
    setLanguage('en');
    const books = new InMemoryBookRepository();
    const book = books.seed({ id: 'mulino', title: 'The Mill Hives', synopsis: 'A plot.' });
    const screen = await render(
      <ThemeProvider>
        <SynopsisTab
          book={book}
          bookRepository={books}
          chapterRepository={new InMemoryChapterRepository()}
          outlineService={new InMemoryOutlineService()}
        />
      </ThemeProvider>,
    );
    expect(await screen.findByText('Generate chapter outline')).toBeOnTheScreen();
    expect(screen.getByText('Save synopsis')).toBeOnTheScreen();
  });
});
