import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ThemeProvider } from '../../theme';
import { blend, contrast } from '../../theme/testing/contrast';
import { candlelightPalette } from '../../theme/tokens';
import { CATHEDRAL_OPACITY, CathedralBackdrop } from '../CathedralBackdrop';

describe('CathedralBackdrop', () => {
  it.each(['rose', 'arches'] as const)('draws the %s behind the screen, faint', async (kind) => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <CathedralBackdrop kind={kind} />
      </ThemeProvider>,
    );
    const drawing = getByTestId(`cathedral-${kind}`);
    expect(drawing).toHaveStyle({ opacity: CATHEDRAL_OPACITY, position: 'absolute' });
  });

  it('the rose window hangs at the top of the screen, the arches stand at the bottom', async () => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <CathedralBackdrop kind="rose" />
        <CathedralBackdrop kind="arches" />
      </ThemeProvider>,
    );
    const rose = StyleSheet.flatten(getByTestId('cathedral-rose').props.style);
    expect(rose.top).toBeDefined();
    expect(rose.bottom).toBeUndefined();
    const arches = StyleSheet.flatten(getByTestId('cathedral-arches').props.style);
    expect(arches.bottom).toBeDefined();
    expect(arches.top).toBeUndefined();
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
        <CathedralBackdrop kind="arches" />
      </ThemeProvider>,
    );
    expect(getByTestId('cathedral-arches')).toHaveStyle({ pointerEvents: 'none' });
  });
});

describe('text stays readable on the faintest drawing (worst case: full gold line)', () => {
  const palette = candlelightPalette;
  const underLine = blend(palette.accent, palette.background, CATHEDRAL_OPACITY);

  it.each(['text', 'textMuted', 'textMutedStrong', 'accentText'] as const)(
    '%s keeps 4.5:1 on the background under a drawn line',
    (token) => {
      expect(contrast(palette[token], underLine)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
