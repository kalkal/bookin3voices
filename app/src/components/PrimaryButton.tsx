/**
 * Bottone primario a pillola verde biblioteca ("Rifinisci con AI" nel mockup).
 */
import { Pressable, StyleSheet, Text } from 'react-native';
import type { ReactNode } from 'react';

import { useTheme } from '../theme';

interface PrimaryButtonProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Elemento opzionale (icona) mostrato prima dell'etichetta. */
  icon?: ReactNode;
  testID?: string;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  icon,
  testID,
}: PrimaryButtonProps) {
  const { colors, radius, spacing, typeScale, letterSpacing, fonts } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: colors.primary,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.xxl,
          gap: spacing.sm + 2,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {icon}
      <Text
        style={{
          color: colors.onPrimary,
          fontFamily: fonts.body,
          fontSize: typeScale.body + 1,
          letterSpacing: letterSpacing.button,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
