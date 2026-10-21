// The Android navigation bar follows the theme. In expo-navigation-bar 57 `style`
// is the colour of the bar's CONTENT, like the status bar (native module:
// hasLightBackground = style == "dark"): light buttons on black and gold, dark
// buttons on Paper (owner's phone test, 20 Oct: a white bar over the black app).

import { render } from '@testing-library/react-native';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider } from '../ThemeProvider';
import { ThemedSystemBars, systemBarStyles } from '../systemBars';

jest.mock('expo-navigation-bar', () => ({ NavigationBar: jest.fn(() => null) }));
jest.mock('expo-status-bar', () => ({ StatusBar: jest.fn(() => null) }));

const lastProps = (component: unknown) => {
  const calls = (component as jest.Mock).mock.calls;
  return calls[calls.length - 1]?.[0];
};

describe('systemBarStyles', () => {
  it('black and gold: light content on dark bars', () => {
    expect(systemBarStyles('candlelight')).toEqual({ statusBar: 'light', navigationBar: 'light' });
  });

  it('Paper: dark content on light bars', () => {
    expect(systemBarStyles('paper')).toEqual({ statusBar: 'dark', navigationBar: 'dark' });
  });
});

describe('ThemedSystemBars', () => {
  beforeEach(() => jest.clearAllMocks());

  it('styles both system bars from the active theme', async () => {
    await render(
      <ThemeProvider initialMode="paper">
        <ThemedSystemBars />
      </ThemeProvider>,
    );
    expect(lastProps(NavigationBar)).toEqual(expect.objectContaining({ style: 'dark' }));
    expect(lastProps(StatusBar)).toEqual(expect.objectContaining({ style: 'dark' }));
  });

  it('defaults to the black and gold theme', async () => {
    await render(
      <ThemeProvider>
        <ThemedSystemBars />
      </ThemeProvider>,
    );
    expect(lastProps(NavigationBar)).toEqual(expect.objectContaining({ style: 'light' }));
    expect(lastProps(StatusBar)).toEqual(expect.objectContaining({ style: 'light' }));
  });
});

describe('app.json starts the bar like the default theme', () => {
  it('light buttons on the black and gold first screen', () => {
    const appJson = require('../../../app.json') as { expo: { plugins: unknown[] } };
    const plugin = appJson.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === 'expo-navigation-bar',
    ) as [string, { style: string; enforceContrast: boolean }];
    expect(plugin[1]).toEqual({
      enforceContrast: false,
      style: systemBarStyles('candlelight').navigationBar,
    });
  });
});
