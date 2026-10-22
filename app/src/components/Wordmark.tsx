/**
 * The wordmark «book ⌿ in ⌿ 3 ⌿ voices»: drawn once (docs/images/wordmark.svg,
 * with the redrawn legible k), rendered to a white PNG and tinted with the
 * theme gold, so the black/gold and Paper themes each use their own token.
 * Screen readers hear one label.
 */

import { Image, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '../theme';

/** Width / height of the artwork (viewBox 816 × 122). */
const ASPECT = 816 / 122;

interface WordmarkProps {
  /** Height of the artwork. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function Wordmark({ size = 34, style }: WordmarkProps) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel="book in 3 voices"
      style={[{ alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Image
        testID="wordmark-image"
        source={require('../../assets/brand/wordmark.png')}
        resizeMode="contain"
        style={{
          height: size,
          width: size * ASPECT,
          maxWidth: '100%',
          tintColor: colors.accentText,
        }}
      />
    </View>
  );
}
