/**
 * Card su carta con filetto e angoli quasi vivi (3px), come nel mockup.
 */
import { View } from 'react-native';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';

import { useTheme } from '../theme';

interface CardProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

export function Card({ style, children, ...rest }: CardProps) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.hairline,
          borderRadius: radius.sharp,
          padding: spacing.lg - 2,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
