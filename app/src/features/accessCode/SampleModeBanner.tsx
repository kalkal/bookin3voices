/**
 * Strip above every screen in offline sample mode (judges build without the
 * access code yet): says why the app works on the sample book only and opens
 * the access code prompt. It takes the top system inset itself, so the screens
 * below it add none.
 */
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../../i18n';
import { useTheme } from '../../theme';

export interface SampleModeBannerProps {
  onEnterCode: () => void;
}

export function SampleModeBanner({ onEnterCode }: SampleModeBannerProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();
  const { top } = useSafeAreaInsets();

  return (
    <View
      testID="sample-mode-banner"
      accessibilityRole="summary"
      style={{
        paddingTop: Math.max(0, top) + spacing.sm,
        paddingBottom: spacing.sm,
        paddingHorizontal: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        backgroundColor: colors.panel,
        borderBottomWidth: 1,
        borderBottomColor: colors.hairlineGold,
      }}
    >
      <Text
        style={{
          flex: 1,
          fontFamily: fonts.body,
          fontSize: typeScale.bodySmall,
          color: colors.text,
        }}
      >
        {t('accessCode.banner.text')}
      </Text>
      <Pressable
        accessibilityRole="button"
        testID="sample-mode-enter-code"
        onPress={onEnterCode}
        style={({ pressed }) => ({
          backgroundColor: colors.primary,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: typeScale.bodySmall,
            color: colors.onPrimary,
          }}
        >
          {t('accessCode.banner.button')}
        </Text>
      </Pressable>
    </View>
  );
}
