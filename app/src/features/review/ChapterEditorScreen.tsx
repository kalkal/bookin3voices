/**
 * Chapter editor: text with a drop cap
 * and inline per-category highlights, a suggestion counter chip that
 * opens the Review, and a «Rifinisci con AI» button that invokes the provider
 * (a fake today, the callable later). The pencil switches to manual edit mode:
 * on confirm the controller re-maps/invalidates the spans.
 * All logic lives in useChapterReview; only rendering is here.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OrnamentDivider, PrimaryButton } from '../../components';
import { SHOW_FREE_TIER_WARNING } from '../../lib/freeTier';
import { countWords } from '../../lib/text';
import { t, tn, uiLocale } from '../../i18n';
import { useTheme } from '../../theme';
import { HighlightedChapterText } from './HighlightedChapterText';
import type { ChapterReviewController } from './useChapterReview';

export interface ChapterEditorScreenProps {
  controller: ChapterReviewController;
  /** Header, e.g. "VII · La marea". */
  chapterTitle?: string;
  /** Opens the Review screen. */
  onOpenReview: () => void;
  /** If present, shows the back chevron to the Book. */
  onBack?: () => void;
}

export function ChapterEditorScreen({
  controller,
  chapterTitle,
  onOpenReview,
  onBack,
}: ChapterEditorScreenProps) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // leaving this screen (also towards the Review) saves what was typed
  const { flushDraft } = controller;
  useEffect(() => flushDraft, [flushDraft]);

  const startEditing = () => {
    setDraft(controller.text);
    setEditing(true);
  };
  const finishEditing = () => {
    setEditing(false);
    void controller.applyManualEdit(draft);
  };

  const words = countWords(controller.text);
  const subtitle =
    controller.loadState === 'ready'
      ? tn('review.editor.subtitle', words, { count: words.toLocaleString(uiLocale()) })
      : ' ';

  return (
    <SafeAreaView
      testID="editor-screen"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View
        style={[
          styles.header,
          { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.md },
        ]}
      >
        {onBack !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('review.editor.backToBook')}
            testID="editor-back"
            onPress={() => {
              flushDraft();
              onBack();
            }}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: colors.text, fontSize: typeScale.heading }}>‹</Text>
          </Pressable>
        )}
        <View style={styles.headerText}>
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.display,
              fontSize: typeScale.heading + 2,
            }}
            numberOfLines={1}
          >
            {chapterTitle ?? t('review.editor.chapterFallback')}
          </Text>
          <Text
            testID="editor-subtitle"
            style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: typeScale.caption }}
          >
            {subtitle}
          </Text>
        </View>
        {controller.pendingCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenReview}
            testID="editor-suggestions-chip"
            style={{
              borderWidth: 1,
              borderColor: colors.accent,
              borderRadius: 999,
              paddingVertical: spacing.xs,
              paddingHorizontal: spacing.md,
            }}
          >
            <Text
              style={{
                color: colors.accentText,
                fontFamily: fonts.body,
                fontSize: typeScale.caption,
              }}
            >
              {tn('review.editor.suggestions', controller.pendingCount)}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <OrnamentDivider style={{ marginHorizontal: spacing.xl, marginBottom: spacing.sm }} />

      <ScrollView
        style={styles.textArea}
        contentContainerStyle={{ padding: spacing.xxl, paddingTop: spacing.lg }}
      >
        {controller.loadState === 'loading' ? (
          <ActivityIndicator color={colors.primary} />
        ) : controller.loadState === 'load-error' ? (
          <Text
            testID="editor-load-error"
            style={{ color: colors.textMutedStrong, fontFamily: fonts.bodyItalic }}
          >
            {t('review.editor.loadError')}
          </Text>
        ) : editing ? (
          <TextInput
            testID="editor-input"
            multiline
            autoFocus
            value={draft}
            onChangeText={(next) => {
              setDraft(next);
              controller.editDraft(next);
            }}
            style={{
              color: colors.text,
              fontFamily: fonts.body,
              fontSize: typeScale.bodyLarge,
              lineHeight: Math.round(typeScale.bodyLarge * 1.6),
              minHeight: 220,
              textAlignVertical: 'top',
            }}
          />
        ) : controller.text === '' ? (
          <Text
            testID="editor-empty-hint"
            style={{
              color: colors.textMuted,
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.body,
              textAlign: 'center',
              paddingTop: spacing.xxxl,
            }}
          >
            {t('review.editor.emptyHint')}
          </Text>
        ) : (
          <HighlightedChapterText
            testID="editor-text"
            text={controller.text}
            suggestions={controller.suggestions}
            onPressSuggestion={() => onOpenReview()}
          />
        )}
        {controller.refineFailed ? (
          <Text
            testID="editor-refine-error"
            style={{
              color: colors.accentText,
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.caption,
              marginTop: spacing.lg,
            }}
          >
            {t('review.editor.refineFailed')}
          </Text>
        ) : null}
        {controller.refineBornStale ? (
          <Text
            testID="editor-refine-stale"
            style={{
              color: colors.accentText,
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.caption,
              marginTop: spacing.lg,
            }}
          >
            {t('review.editor.refineStale')}
          </Text>
        ) : null}
      </ScrollView>

      {SHOW_FREE_TIER_WARNING && (
        <View
          testID="editor-freekey-warning"
          style={{
            marginHorizontal: spacing.xl,
            marginBottom: spacing.sm,
            paddingVertical: spacing.xs,
            paddingHorizontal: spacing.md,
            borderWidth: 1,
            borderColor: colors.accent,
            borderRadius: 8,
          }}
        >
          <Text
            style={{
              color: colors.accentText,
              fontFamily: fonts.bodySemiBold,
              fontSize: typeScale.caption,
            }}
          >
            {t('review.editor.freeKeyTitle')}
          </Text>
          <Text
            style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: typeScale.caption }}
          >
            {t('review.editor.freeKeyBody')}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.panel,
          {
            borderTopColor: colors.hairline,
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.lg,
            paddingBottom: spacing.xl,
            gap: spacing.md,
          },
        ]}
      >
        <RoundButton
          testID="editor-edit-toggle"
          icon={editing ? 'checkmark' : 'pencil'}
          color={editing ? colors.primary : colors.textMutedStrong}
          borderColor={editing ? colors.primary : colors.hairlineGold}
          disabled={controller.loadState !== 'ready'}
          onPress={editing ? finishEditing : startEditing}
        />
        <View style={styles.refineButton}>
          <PrimaryButton
            testID="editor-refine"
            label={controller.refining ? t('review.editor.refining') : t('review.editor.refine')}
            disabled={
              controller.refining ||
              editing ||
              controller.loadState !== 'ready' ||
              controller.text === ''
            }
            onPress={() => {
              flushDraft();
              void controller.refine();
            }}
            icon={
              controller.refining ? (
                <ActivityIndicator size="small" color={colors.onPrimary} />
              ) : (
                <Ionicons name="sparkles-outline" size={18} color={colors.onPrimary} />
              )
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function RoundButton({
  icon,
  color,
  borderColor,
  onPress,
  disabled,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  borderColor: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={[styles.roundButton, { borderColor, opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  headerText: { flex: 1, gap: 2 },
  textArea: { flex: 1 },
  panel: {
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  refineButton: { flex: 1 },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
