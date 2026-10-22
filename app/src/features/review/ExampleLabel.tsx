/**
 * The «Example — pre-recorded, not live AI» label: shown wherever
 * pre-recorded example suggestions are on screen (judges' build), so they are
 * never taken for a live AI answer. `compact` is the one-line tag on a card;
 * the full banner adds the sentence saying why the examples are there.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { t } from '../../i18n';
import { useTheme } from '../../theme';

export function ExampleLabel({ compact = false, testID }: { compact?: boolean; testID?: string }) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityRole={compact ? undefined : 'alert'}
      style={[
        styles.box,
        {
          borderColor: colors.accent,
          paddingVertical: compact ? 2 : spacing.xs,
          paddingHorizontal: compact ? spacing.sm : spacing.md,
          gap: spacing.sm,
        },
        compact ? styles.compact : null,
      ]}
    >
      <Ionicons name="albums-outline" size={compact ? 14 : 16} color={colors.accentText} />
      <View style={styles.text}>
        <Text
          style={{
            color: colors.accentText,
            fontFamily: fonts.bodySemiBold,
            fontSize: compact ? typeScale.label : typeScale.caption,
          }}
        >
          {t('review.example.label')}
        </Text>
        {compact ? null : (
          <Text
            style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: typeScale.caption }}
          >
            {t('review.example.body')}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8 },
  compact: { alignSelf: 'flex-start' },
  text: { flexShrink: 1 },
});
