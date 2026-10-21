/**
 * The system bars follow the theme. The app draws edge to edge, so with the
 * contrast scrim off (`enforceContrast: false` in app.json) the screen
 * background shows under Android's navigation bar; here only the colour of the
 * bars' content changes: light icons and buttons on black and gold, dark ones
 * on Paper.
 */

import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';

import type { ThemeMode } from './ThemeProvider';
import { useTheme } from './ThemeProvider';

/**
 * Both values are the colour of the bars' CONTENT. For expo-navigation-bar 57
 * the docs say the opposite, but the native module sets a light background when
 * the style is "dark" (dark buttons), exactly like the status bar.
 */
export function systemBarStyles(mode: ThemeMode): {
  statusBar: 'light' | 'dark';
  navigationBar: 'light' | 'dark';
} {
  // light icons and buttons on black and gold, dark ones on Paper
  return mode === 'paper'
    ? { statusBar: 'dark', navigationBar: 'dark' }
    : { statusBar: 'light', navigationBar: 'light' };
}

export function ThemedSystemBars() {
  const { mode } = useTheme();
  const styles = systemBarStyles(mode);
  return (
    <>
      <StatusBar style={styles.statusBar} />
      <NavigationBar style={styles.navigationBar} />
    </>
  );
}
