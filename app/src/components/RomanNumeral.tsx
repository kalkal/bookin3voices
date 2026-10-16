/**
 * Numerale romano di capitolo in Cormorant Garamond oro (firma visiva).
 */
import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { toRoman } from '../lib/roman';
import { useTheme } from '../theme';

interface RomanNumeralProps {
  /** Numero del capitolo (1–3999). */
  value: number;
  /** Dimensione in px; default: scala `heading` (elenco capitoli). */
  size?: number;
  /** Colore alternativo (es. inchiostro nei titoli di schermata). */
  color?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function RomanNumeral({ value, size, color, style, testID }: RomanNumeralProps) {
  const { colors, typeScale, fonts } = useTheme();

  return (
    <Text
      testID={testID}
      style={[
        {
          fontFamily: fonts.display,
          fontSize: size ?? typeScale.heading,
          color: color ?? colors.accent,
        },
        style,
      ]}
    >
      {toRoman(value)}
    </Text>
  );
}
