/**
 * Paragraph with a green drop cap in Cormorant Garamond (editor).
 * React Native has no CSS float: the drop cap is rendered inline on the first
 * line (a left column for the first line only, via a two-column layout, would
 * be the alternative, but it would break the text flow).
 */
import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { useTheme } from '../theme';

interface DropCapProps {
  /** Paragraph text; the first letter becomes the drop cap. */
  text: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function DropCap({ text, style, testID }: DropCapProps) {
  const { colors, typeScale, fonts } = useTheme();
  // First grapheme (also handles composed accented letters).
  const [first = '', ...rest] = Array.from(text);

  return (
    <Text
      testID={testID}
      style={[
        {
          fontFamily: fonts.body,
          fontSize: typeScale.bodyLarge,
          lineHeight: typeScale.bodyLarge * 1.8,
          color: colors.text,
        },
        style,
      ]}
    >
      <Text
        testID={testID ? `${testID}-cap` : undefined}
        style={{
          fontFamily: fonts.display,
          fontSize: typeScale.dropCap * 0.75,
          color: colors.primary,
        }}
      >
        {first}
      </Text>
      {rest.join('')}
    </Text>
  );
}
