import { act, render } from '@testing-library/react-native';

import { setLanguage } from '../../../i18n';
import { ThemeProvider } from '../../../theme';
import { FakeDictationEngine } from '../../dictation';
import { InMemoryNoteRepository } from '../InMemoryNoteRepository';
import { NotesScreen } from '../NotesScreen';

describe('NotesScreen in English', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => setLanguage('it'));

  it('shows the English empty state', async () => {
    const { getByText } = await render(
      <ThemeProvider>
        <NotesScreen
          bookId="b"
          bookTitle="Book"
          noteRepository={new InMemoryNoteRepository()}
          engine={new FakeDictationEngine()}
          onBack={jest.fn()}
        />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(getByText('The notebook is empty')).toBeTruthy();
  });
});
