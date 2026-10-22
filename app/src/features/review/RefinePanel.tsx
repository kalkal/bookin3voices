/**
 * The panel a refine starts from: WHAT is refined (the scope: whole chapter,
 * selection or paragraph) and WHICH kinds the AI checks (style, grammar,
 * pacing, period details), all on by default. «Avvia» sends the request;
 * with every kind off there is nothing to check, so it is disabled.
 * Sits in the toolbar above the keyboard: never over the text.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip } from '../../components';
import { t } from '../../i18n';
import { useTheme } from '../../theme';
import { KIND_LABELS, SUGGESTION_KINDS, type SuggestionKind } from './types';

export type RefineScope =
  | { kind: 'chapter' }
  | { kind: 'selection'; range: { from: number; to: number } }
  | { kind: 'paragraph'; range: { from: number; to: number } };

const SCOPE_KEYS: Record<RefineScope['kind'], string> = {
  chapter: 'review.panel.scope.chapter',
  selection: 'review.panel.scope.selection',
  paragraph: 'review.panel.scope.paragraph',
};

export function RefinePanel({
  scope,
  kindsOn,
  onToggle,
  onStart,
  onCancel,
}: {
  scope: RefineScope['kind'];
  kindsOn: readonly SuggestionKind[];
  onToggle: (kind: SuggestionKind) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  return (
    <View testID="refine-panel" style={{ gap: spacing.sm }}>
      <Text
        testID="refine-scope"
        style={{
          color: colors.textMutedStrong,
          fontFamily: fonts.body,
          fontSize: typeScale.caption,
        }}
      >
        {t('review.panel.scope', { scope: t(SCOPE_KEYS[scope]) })}
      </Text>
      <View style={[styles.row, { gap: spacing.sm }]}>
        {SUGGESTION_KINDS.map((kind) => {
          const on = kindsOn.includes(kind);
          return (
            <Pressable
              key={kind}
              testID={`refine-kind-${kind}`}
              accessibilityRole="switch"
              accessibilityLabel={KIND_LABELS[kind]}
              accessibilityState={{ checked: on }}
              onPress={() => onToggle(kind)}
              style={[
                styles.toggle,
                {
                  borderColor: on ? colors.primary : colors.hairline,
                  backgroundColor: on ? colors.selectedTint : undefined,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                },
              ]}
            >
              <Text
                style={{
                  color: on ? colors.text : colors.textMuted,
                  fontFamily: fonts.body,
                  fontSize: typeScale.caption,
                  // never colour alone: an «off» kind is also struck through
                  textDecorationLine: on ? 'none' : 'line-through',
                }}
              >
                {KIND_LABELS[kind]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Chip
          label={t('review.panel.start')}
          tone="green"
          testID="refine-start"
          // with every kind off there is nothing to check
          disabled={kindsOn.length === 0}
          onPress={onStart}
        />
        <Chip label={t('review.panel.cancel')} testID="refine-cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  toggle: { borderWidth: 1, borderRadius: 999 },
});
