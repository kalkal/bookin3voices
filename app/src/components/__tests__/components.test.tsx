import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { Card, Chip, DropCap, OrnamentDivider, PrimaryButton, RomanNumeral } from '..';
import { ThemeProvider, paperPalette } from '../../theme';

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('PrimaryButton', () => {
  it('is a library-green pill with paper text', async () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = await renderWithTheme(
      <PrimaryButton label="Rifinisci con AI" onPress={onPress} testID="btn" />,
    );
    expect(getByTestId('btn')).toHaveStyle({ backgroundColor: paperPalette.primary });
    expect(getByText('Rifinisci con AI')).toHaveStyle({ color: paperPalette.onPrimary });
    await fireEvent.press(getByTestId('btn'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('when disabled does not call onPress', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await renderWithTheme(
      <PrimaryButton label="Rifinisci" onPress={onPress} disabled testID="btn" />,
    );
    await fireEvent.press(getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Chip', () => {
  it('selected is solid green with paper text', async () => {
    const { getByTestId, getByText } = await renderWithTheme(
      <Chip label="Tutti" selected testID="chip" />,
    );
    expect(getByTestId('chip')).toHaveStyle({ backgroundColor: paperPalette.primary });
    expect(getByText('Tutti')).toHaveStyle({ color: paperPalette.onPrimary });
  });

  it('unselected has a muted gold border', async () => {
    const { getByTestId } = await renderWithTheme(<Chip label="Stile" testID="chip" />);
    expect(getByTestId('chip')).toHaveStyle({
      borderWidth: 1,
      borderColor: paperPalette.hairlineGold,
    });
  });

  it('as a gold tag is uppercase with readable gold text', async () => {
    const { getByTestId, getByText } = await renderWithTheme(
      <Chip label="Stile" tone="gold" uppercase testID="chip" />,
    );
    expect(getByTestId('chip')).toHaveStyle({ borderColor: paperPalette.accent });
    expect(getByText('Stile')).toHaveStyle({
      color: paperPalette.accentText,
      textTransform: 'uppercase',
    });
  });
});

describe('Card', () => {
  it('is card paper with a hairline and nearly sharp corners', async () => {
    const { getByTestId } = await renderWithTheme(<Card testID="card" />);
    expect(getByTestId('card')).toHaveStyle({
      backgroundColor: paperPalette.surface,
      borderColor: paperPalette.hairline,
      borderRadius: 3,
    });
  });
});

describe('OrnamentDivider', () => {
  it('in prominent variant the diamond is antique gold', async () => {
    const { getByTestId } = await renderWithTheme(<OrnamentDivider prominent testID="div" />);
    expect(getByTestId('div-diamond')).toHaveStyle({
      backgroundColor: paperPalette.accent,
      transform: [{ rotate: '45deg' }],
    });
  });

  it('in normal variant the diamond is muted gold', async () => {
    const { getByTestId } = await renderWithTheme(<OrnamentDivider testID="div" />);
    expect(getByTestId('div-diamond')).toHaveStyle({
      backgroundColor: paperPalette.hairlineGold,
    });
  });
});

describe('RomanNumeral', () => {
  it('renders the Roman numeral in antique gold', async () => {
    const { getByText } = await renderWithTheme(<RomanNumeral value={7} />);
    expect(getByText('VII')).toHaveStyle({ color: paperPalette.accent });
  });

  it('accepts alternative color and size', async () => {
    const { getByText } = await renderWithTheme(
      <RomanNumeral value={12} size={24} color={paperPalette.text} />,
    );
    expect(getByText('XII')).toHaveStyle({ color: paperPalette.text, fontSize: 24 });
  });
});

describe('DropCap', () => {
  it('splits the first letter off as a green drop cap', async () => {
    const { getByTestId } = await renderWithTheme(
      <DropCap text="Il caffè era ancora caldo." testID="dc" />,
    );
    expect(getByTestId('dc-cap')).toHaveTextContent('I');
    expect(getByTestId('dc-cap')).toHaveStyle({ color: paperPalette.primary });
    expect(getByTestId('dc')).toHaveTextContent('Il caffè era ancora caldo.');
  });
});
