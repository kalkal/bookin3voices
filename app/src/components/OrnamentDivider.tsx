/**
 * Ornamental divider: line · golden diamond · line (visual signature).
 * `prominent` variant for title pages (under "bookin3voice" in the mockup),
 * normal variant for inner dividers (editor).
 */
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '../theme';

interface OrnamentDividerProps {
  /** Muted gold lines and solid gold diamond (title page). */
  prominent?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function OrnamentDivider({ prominent = false, style, testID }: OrnamentDividerProps) {
  const { colors, spacing } = useTheme();
  const lineColor = prominent ? colors.hairlineGold : colors.hairline;
  const diamondColor = prominent ? colors.accent : colors.hairlineGold;
  const diamondSize = prominent ? 7 : 6;

  return (
    <View style={[styles.row, { gap: spacing.sm + 2 }, style]} testID={testID}>
      <View style={[styles.line, { backgroundColor: lineColor }]} />
      <View
        testID={testID ? `${testID}-diamond` : undefined}
        style={{
          width: diamondSize,
          height: diamondSize,
          backgroundColor: diamondColor,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View style={[styles.line, { backgroundColor: lineColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  line: {
    flex: 1,
    height: 1,
  },
});
