/**
 * Chapter Roman numeral in gold Cormorant Garamond (visual signature).
 */
import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { toRoman } from '../lib/roman';
import { useTheme } from '../theme';

interface RomanNumeralProps {
  /** Chapter number (1–3999). */
  value: number;
  /** Size in px; default: `heading` scale (chapter list). */
  size?: number;
  /** Alternative color (e.g. ink in screen titles). */
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
