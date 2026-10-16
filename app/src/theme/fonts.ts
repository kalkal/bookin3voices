/**
 * Caricamento dei Google Fonts del tema: EB Garamond per corpo e
 * UI, Cormorant Garamond per titoli, numerali e capolettera.
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
 * Nomi delle famiglie caricate, da usare come `fontFamily`.
 * Le chiavi semantiche tengono i componenti indipendenti dai nomi Expo.
 */
export const fontFamilies = {
  /** Titoli e numerali (Cormorant Garamond 600). */
  display: 'CormorantGaramond_600SemiBold',
  /** Titoli di peso maggiore. */
  displayBold: 'CormorantGaramond_700Bold',
  /** Display di peso medio. */
  displayMedium: 'CormorantGaramond_500Medium',
  /** Display corsivo. */
  displayItalic: 'CormorantGaramond_500Medium_Italic',
  /** Corpo e UI (EB Garamond 400). */
  body: 'EBGaramond_400Regular',
  /** Corsivo del corpo (didascalie, comandi vocali). */
  bodyItalic: 'EBGaramond_400Regular_Italic',
  /** Corpo di peso medio. */
  bodyMedium: 'EBGaramond_500Medium',
  /** Corsivo di peso medio. */
  bodyMediumItalic: 'EBGaramond_500Medium_Italic',
  /** Corpo semi-grassetto (enfasi, titoli di riga). */
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
 * Carica i font del tema all'avvio. Restituisce `true` a caricamento
 * completato oppure in caso di errore (l'app parte comunque col serif di
 * sistema, `serifFallback` in tokens.ts, invece di restare bloccata).
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(fontMap);
  return loaded || error != null;
}
