import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ThemeProvider } from '../../theme';
import { blend, contrast } from '../../theme/testing/contrast';
import { candlelightPalette, paperPalette } from '../../theme/tokens';
import { CATHEDRAL_OPACITY, CathedralBackdrop } from '../CathedralBackdrop';

describe('CathedralBackdrop', () => {
  it('draws the rose window behind the Library, faint, hanging from the top', async () => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <CathedralBackdrop kind="rose" />
      </ThemeProvider>,
    );
    const rose = getByTestId('cathedral-rose');
    expect(rose).toHaveStyle({ opacity: CATHEDRAL_OPACITY, position: 'absolute' });
    const style = StyleSheet.flatten(rose.props.style);
    expect(style.top).toBeDefined();
    expect(style.bottom).toBeUndefined();
  });

  it('is not drawn when the switch in Settings is off', async () => {
    const { queryByTestId } = await render(
      <ThemeProvider initialOrnaments={false}>
        <CathedralBackdrop kind="rose" />
      </ThemeProvider>,
    );
    expect(queryByTestId('cathedral-rose')).toBeNull();
  });

  it('never takes a touch from the screen under it', async () => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <CathedralBackdrop kind="rose" />
      </ThemeProvider>,
    );
    expect(getByTestId('cathedral-rose')).toHaveStyle({ pointerEvents: 'none' });
  });
});

// The drawings are PNGs of ONE colour whatever the theme (the gold of the black-and-gold accent).
// Worst case for the text: the background right under a full line.
const LINE = candlelightPalette.accent;

describe('text stays readable on the faintest drawing, black and gold (AA, 4.5:1)', () => {
  const palette = candlelightPalette;
  const underLine = blend(LINE, palette.background, CATHEDRAL_OPACITY);

  it.each(['text', 'textMuted', 'textMutedStrong', 'accentText'] as const)(
    '%s keeps 4.5:1 on the background under a drawn line',
    (token) => {
      expect(contrast(palette[token], underLine)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

// The cathedral is on in the cream theme too (an owner decision). Cream text was ALREADY under
// 4.5:1 without any drawing (muted 3.59, gold 4.25): those two are pinned at today's values so
// the drawing and the palette cannot push them further down (floors = today's values rounded down); the others stay AA. Raising the cream
// secondary text contrast, without changing the look, is a follow-up.
describe('cream theme (Carta): the drawing does not make the text worse than today', () => {
  const palette = paperPalette;
  const underLine = blend(LINE, palette.background, CATHEDRAL_OPACITY);

  it.each([
    ['text', 4.5],
    ['textMutedStrong', 4.5],
  ] as const)('%s keeps AA under a drawn line', (token, floor) => {
    expect(contrast(palette[token], underLine)).toBeGreaterThanOrEqual(floor);
  });

  it.each([
    // [token, floor without the drawing (today), floor under a line (today)]
    ['textMuted', 3.5, 3.2],
    ['accentText', 4.2, 3.8],
  ] as const)('%s stays near the value of today (known below AA)', (token, plain, under) => {
    expect(contrast(palette[token], palette.background)).toBeGreaterThanOrEqual(plain);
    expect(contrast(palette[token], underLine)).toBeGreaterThanOrEqual(under);
  });
});
