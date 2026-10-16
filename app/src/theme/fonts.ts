/**
 * Loading of the theme's Google Fonts: EB Garamond for body and
 * UI, Cormorant Garamond for titles, numerals and drop caps.
 */
import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
  CormorantGaramond_600SemiBold,
  CormorantGaramond_700Bold,
} from '@expo-google-fonts/cormorant-garamond';
import {
  EBGaramond_400Regular,
  EBGaramond_400Regular_Italic,
  EBGaramond_500Medium,
  EBGaramond_500Medium_Italic,
  EBGaramond_600SemiBold,
} from '@expo-google-fonts/eb-garamond';
import { useFonts } from 'expo-font';

/**
 * Names of the loaded families, to be used as `fontFamily`.
 * The semantic keys keep components independent of Expo's names.
 */
export const fontFamilies = {
  /** Titles and numerals (Cormorant Garamond 600). */
  display: 'CormorantGaramond_600SemiBold',
  /** Heavier titles. */
  displayBold: 'CormorantGaramond_700Bold',
  /** Medium-weight display. */
  displayMedium: 'CormorantGaramond_500Medium',
  /** Italic display. */
  displayItalic: 'CormorantGaramond_500Medium_Italic',
  /** Body and UI (EB Garamond 400). */
  body: 'EBGaramond_400Regular',
  /** Body italic (captions, voice commands). */
  bodyItalic: 'EBGaramond_400Regular_Italic',
  /** Medium-weight body. */
  bodyMedium: 'EBGaramond_500Medium',
  /** Medium-weight italic. */
  bodyMediumItalic: 'EBGaramond_500Medium_Italic',
  /** Semi-bold body (emphasis, row titles). */
  bodySemiBold: 'EBGaramond_600SemiBold',
} as const;

export type FontFamilyKey = keyof typeof fontFamilies;

const fontMap = {
  [fontFamilies.display]: CormorantGaramond_600SemiBold,
  [fontFamilies.displayBold]: CormorantGaramond_700Bold,
  [fontFamilies.displayMedium]: CormorantGaramond_500Medium,
  [fontFamilies.displayItalic]: CormorantGaramond_500Medium_Italic,
  [fontFamilies.body]: EBGaramond_400Regular,
  [fontFamilies.bodyItalic]: EBGaramond_400Regular_Italic,
  [fontFamilies.bodyMedium]: EBGaramond_500Medium,
  [fontFamilies.bodyMediumItalic]: EBGaramond_500Medium_Italic,
  [fontFamilies.bodySemiBold]: EBGaramond_600SemiBold,
};

/**
 * Loads the theme fonts at startup. Returns `true` once loading has
 * completed or on error (the app still starts with the system serif,
 * `serifFallback` in tokens.ts, instead of staying blocked).
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(fontMap);
  return loaded || error != null;
}
