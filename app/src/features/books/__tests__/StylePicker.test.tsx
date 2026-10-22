import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import { StylePicker } from '../StylePicker';
import { DEFAULT_STYLE_ID, resolveStyleId, STYLE_IDS, STYLES } from '../styles';
import type { Book } from '../types';

function book(styleProfileId: string | null): Book {
  return {
    id: 'b1',
    schemaVersion: 1,
    title: 'The Night Shift',
    author: 'Jane Doe',
    description: '',
    synopsis: '',
    genre: '',
    language: 'en',
    status: 'draft',
    styleProfileId,
    wordCount: 0,
    chapterCount: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

async function renderPicker(styleProfileId: string | null, onChange = jest.fn()) {
  const screen = await render(
    <ThemeProvider>
      <StylePicker book={book(styleProfileId)} onChange={onChange} />
    </ThemeProvider>,
  );
  return { screen, onChange };
}

describe('style registry (app mirror)', () => {
  it('offers suspense, mystery and historical; unknown ids resolve to the default', () => {
    expect(STYLES.map((s) => s.id)).toEqual([...STYLE_IDS]);
    expect(STYLE_IDS).toEqual(['suspense', 'mystery', 'historical']);
    expect(DEFAULT_STYLE_ID).toBe('suspense');
    expect(resolveStyleId(null)).toBe('suspense');
    expect(resolveStyleId('skynet')).toBe('suspense');
    expect(resolveStyleId('historical')).toBe('historical');
    // books saved with the retired thriller style open as historical
    expect(resolveStyleId('thriller')).toBe('historical');
  });
});

describe('StylePicker', () => {
  it('shows every style and the summary of the current one', async () => {
    const { screen } = await renderPicker('mystery');
    for (const style of STYLES) {
      expect(screen.getByTestId(`style-option-${style.id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('style-summary')).toHaveTextContent(/indizi/);
  });

  it('a book without a style shows the default one', async () => {
    const { screen } = await renderPicker(null);
    expect(screen.getByTestId('style-summary')).toHaveTextContent(/minaccia/);
  });

  it('tapping a style reports its id', async () => {
    const { screen, onChange } = await renderPicker('suspense');
    await fireEvent.press(screen.getByTestId('style-option-historical'));
    expect(onChange).toHaveBeenCalledWith('historical');
  });

  it('a book saved as thriller shows Storico selected, without rewriting it', async () => {
    const { screen, onChange } = await renderPicker('thriller');
    expect(screen.getByTestId('style-summary')).toHaveTextContent(/epoca/);
    expect(screen.queryByTestId('style-option-thriller')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
