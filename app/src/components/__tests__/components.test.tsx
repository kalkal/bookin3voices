import { fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { Card, Chip, DropCap, OrnamentDivider, PrimaryButton, RomanNumeral } from '..';
import { ThemeProvider, paperPalette } from '../../theme';

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('PrimaryButton', () => {
  it('è una pillola verde biblioteca con testo carta', async () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = await renderWithTheme(
      <PrimaryButton label="Rifinisci con AI" onPress={onPress} testID="btn" />,
    );
    expect(getByTestId('btn')).toHaveStyle({ backgroundColor: paperPalette.primary });
    expect(getByText('Rifinisci con AI')).toHaveStyle({ color: paperPalette.onPrimary });
    await fireEvent.press(getByTestId('btn'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('da disabilitato non chiama onPress', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await renderWithTheme(
      <PrimaryButton label="Rifinisci" onPress={onPress} disabled testID="btn" />,
    );
    await fireEvent.press(getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Chip', () => {
  it('selezionata è verde piena con testo carta', async () => {
    const { getByTestId, getByText } = await renderWithTheme(
      <Chip label="Tutti" selected testID="chip" />,
    );
    expect(getByTestId('chip')).toHaveStyle({ backgroundColor: paperPalette.primary });
    expect(getByText('Tutti')).toHaveStyle({ color: paperPalette.onPrimary });
  });

  it('non selezionata ha bordo oro attenuato', async () => {
    const { getByTestId } = await renderWithTheme(<Chip label="Stile" testID="chip" />);
    expect(getByTestId('chip')).toHaveStyle({
      borderWidth: 1,
      borderColor: paperPalette.hairlineGold,
    });
  });

  it('come tag oro è maiuscola con testo oro leggibile', async () => {
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
  it('è carta card con filetto e angoli quasi vivi', async () => {
    const { getByTestId } = await renderWithTheme(<Card testID="card" />);
    expect(getByTestId('card')).toHaveStyle({
      backgroundColor: paperPalette.surface,
      borderColor: paperPalette.hairline,
      borderRadius: 3,
    });
  });
});

describe('OrnamentDivider', () => {
  it('in variante prominente il rombo è oro antico', async () => {
    const { getByTestId } = await renderWithTheme(<OrnamentDivider prominent testID="div" />);
    expect(getByTestId('div-diamond')).toHaveStyle({
      backgroundColor: paperPalette.accent,
      transform: [{ rotate: '45deg' }],
    });
  });

  it('in variante normale il rombo è oro attenuato', async () => {
    const { getByTestId } = await renderWithTheme(<OrnamentDivider testID="div" />);
    expect(getByTestId('div-diamond')).toHaveStyle({
      backgroundColor: paperPalette.hairlineGold,
    });
  });
});

describe('RomanNumeral', () => {
  it('rende il numerale romano in oro antico', async () => {
    const { getByText } = await renderWithTheme(<RomanNumeral value={7} />);
    expect(getByText('VII')).toHaveStyle({ color: paperPalette.accent });
  });

  it('accetta colore e dimensione alternativi', async () => {
    const { getByText } = await renderWithTheme(
      <RomanNumeral value={12} size={24} color={paperPalette.text} />,
    );
    expect(getByText('XII')).toHaveStyle({ color: paperPalette.text, fontSize: 24 });
  });
});

describe('DropCap', () => {
  it('stacca la prima lettera come capolettera verde', async () => {
    const { getByTestId } = await renderWithTheme(
      <DropCap text="Il caffè era ancora caldo." testID="dc" />,
    );
    expect(getByTestId('dc-cap')).toHaveTextContent('I');
    expect(getByTestId('dc-cap')).toHaveStyle({ color: paperPalette.primary });
    expect(getByTestId('dc')).toHaveTextContent('Il caffè era ancora caldo.');
  });
});
