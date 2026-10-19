/**
 * Two-mode theme provider: "candlelight" (black and gold, the default) and "paper"
 * (cream). Components read everything from `useTheme`,
 * never from the raw tokens, so switching theme stays a provider detail.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { fontFamilies } from './fonts';
import {
  candlelightPalette,
  letterSpacing,
  paperPalette,
  radius,
  spacing,
  typeScale,
} from './tokens';
import type { Palette } from './tokens';

export type ThemeMode = 'paper' | 'candlelight';

export interface Theme {
  mode: ThemeMode;
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  typeScale: typeof typeScale;
  letterSpacing: typeof letterSpacing;
  fonts: typeof fontFamilies;
  setMode: (mode: ThemeMode) => void;
  /** Cathedral line drawing behind some screens (Settings can switch it off). */
  ornaments: boolean;
  setOrnaments: (on: boolean) => void;
}

const palettes: Record<ThemeMode, Palette> = {
  paper: paperPalette,
  candlelight: candlelightPalette,
};

const ThemeContext = createContext<Theme | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
  /** Initial mode; the app default is black and gold ("candlelight"). */
  initialMode?: ThemeMode;
  /** Cathedral drawing on or off; on by default. */
  initialOrnaments?: boolean;
}

export function ThemeProvider({
  children,
  initialMode = 'candlelight',
  initialOrnaments = true,
}: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);
  const [ornaments, setOrnaments] = useState(initialOrnaments);

  const theme = useMemo<Theme>(
    () => ({
      mode,
      colors: palettes[mode],
      spacing,
      radius,
      typeScale,
      letterSpacing,
      fonts: fontFamilies,
      setMode,
      ornaments,
      setOrnaments,
    }),
    [mode, setMode, ornaments],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Current theme; to be used only under `ThemeProvider`. */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return theme;
}
