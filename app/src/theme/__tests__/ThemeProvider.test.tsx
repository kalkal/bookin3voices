import { fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { ThemeProvider, useTheme } from '../ThemeProvider';
import { candlelightPalette, paperPalette } from '../tokens';

function Probe() {
  const { mode, colors, setMode } = useTheme();
  return (
    <Pressable testID="toggle" onPress={() => setMode('candlelight')}>
      <Text testID="mode">{mode}</Text>
      <Text testID="background">{colors.background}</Text>
    </Pressable>
  );
}

describe('ThemeProvider', () => {
  it('parte in tema carta', async () => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(getByTestId('mode')).toHaveTextContent('paper');
    expect(getByTestId('background')).toHaveTextContent(paperPalette.background);
  });

  it('passa al tema a lume di candela con setMode', async () => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await fireEvent.press(getByTestId('toggle'));
    expect(getByTestId('mode')).toHaveTextContent('candlelight');
    expect(getByTestId('background')).toHaveTextContent(candlelightPalette.background);
  });

  it('useTheme fuori dal provider lancia un errore esplicito', async () => {
    // Sopprime il log dell'errore di render atteso.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render(<Probe />)).rejects.toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});
