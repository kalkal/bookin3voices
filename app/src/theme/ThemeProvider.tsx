/**
 * Provider del tema a due modalità: "paper" (default) e "candlelight"
 * (scuro, abbozzato). I componenti leggono tutto da `useTheme`,
 * mai dai token grezzi, così il cambio tema resta un dettaglio del provider.
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
}

const palettes: Record<ThemeMode, Palette> = {
  paper: paperPalette,
  candlelight: candlelightPalette,
};

const ThemeContext = createContext<Theme | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
  /** Modalità iniziale; il default dell'app è il tema carta. */
  initialMode?: ThemeMode;
}

export function ThemeProvider({ children, initialMode = 'paper' }: ThemeProviderProps) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const setMode = useCallback((next: ThemeMode) => setModeState(next), []);

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
    }),
    [mode, setMode],
  );

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** Tema corrente; da usare solo sotto `ThemeProvider`. */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === null) {
    throw new Error('useTheme va usato dentro <ThemeProvider>');
  }
  return theme;
}
