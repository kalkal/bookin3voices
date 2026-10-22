/**
 * Chapter editor: text with a drop cap
 * and inline per-category highlights, a suggestion counter chip that
 * opens the Review, and a «Rifinisci con AI» button that invokes the provider
 * (a fake today, the callable later). The pencil switches to manual edit mode:
 * on confirm the controller re-maps/invalidates the spans.
 * All logic lives in useChapterReview; only rendering is here.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  Chip,
  OrnamentDivider,
  PrimaryButton,
  Screen,
  useBottomClearance,
  useKeyboardRoom,
} from '../../components';
import { SHOW_FREE_TIER_WARNING } from '../../lib/freeTier';
import { countWords } from '../../lib/text';
import { t, tn, uiLocale } from '../../i18n';
import { useTheme } from '../../theme';
import { HighlightedChapterText } from './HighlightedChapterText';
import { MIN_SELECTION_WORDS, selectionWords } from './selection';
import type { ChapterReviewController } from './useChapterReview';

/** Tallest the open beats panel may be while the keyboard is up (it scrolls inside). */
export const EDITOR_OUTLINE_MAX_WITH_KEYBOARD = 132;

export interface ChapterEditorScreenProps {
  controller: ChapterReviewController;
  /** Header, e.g. "VII · La piena". */
  chapterTitle?: string;
  /** Opens the Review screen. */
  onOpenReview: () => void;
  /** If present, shows the back chevron to the Book. */
  onBack?: () => void;
  /** The chapter's key beats (OutlineTrack), under the header. */
  outlinePanel?: ReactNode;
}

export function ChapterEditorScreen({
  controller,
  outlinePanel,
  chapterTitle,
  onOpenReview,
  onBack,
}: ChapterEditorScreenProps) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  const bottomClearance = useBottomClearance(spacing.xl);
  // with the keyboard open the body ends above it (edge-to-edge: Android no
  // longer shrinks the window) and the navigation bar is behind the keyboard
  const keyboardRoom = useKeyboardRoom();
  const panelBottom = keyboardRoom > 0 ? spacing.md : bottomClearance;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // «Rifinisci la selezione»: the selection of the edit field, if any
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);

  // leaving this screen (also towards the Review) saves what was typed
  const { flushDraft } = controller;
  useEffect(() => flushDraft, [flushDraft]);

  const startEditing = () => {
    setDraft(controller.text);
    setSelection(null);
    setEditing(true);
  };
  const finishEditing = () => {
    setEditing(false);
    setSelection(null);
    void controller.applyManualEdit(draft);
  };
  // shown only after tapping Refine with a too-short selection; cleared on any change
  const [selectionHint, setSelectionHint] = useState('');
  const refineSelection = async (range: { from: number; to: number }) => {
    // too short: stay in the editor with the selection; the hint is a line in the
    // toolbar above the keyboard, never a banner taking the text's room
    if (selectionWords(draft, range) < MIN_SELECTION_WORDS) {
      setSelectionHint(t('review.editor.selectionTooShort', { count: MIN_SELECTION_WORDS }));
      return;
    }
    // the result and any message must not hide behind the keyboard
    Keyboard.dismiss();
    // the typed text is applied first: the range refers to it
    setEditing(false);
    setSelection(null);
    await controller.applyManualEdit(draft);
    await controller.refine(range);
  };

  const words = countWords(controller.text);
  const subtitle =
    controller.loadState === 'ready'
      ? tn('review.editor.subtitle', words, { count: words.toLocaleString(uiLocale()) })
      : ' ';

  return (
    <Screen testID="editor-screen">
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

      <View testID="editor-keyboard-room" style={{ flex: 1, paddingBottom: keyboardRoom }}>
        {outlinePanel !== undefined && (
          // one wrapper in both states (the panel is never remounted): with the
          // keyboard up it is capped and scrolls, so the text keeps its room
          <ScrollView
            testID="editor-outline-room"
            scrollEnabled={keyboardRoom > 0}
            keyboardShouldPersistTaps="handled"
            style={[
              styles.outlineRoom,
              keyboardRoom > 0 ? { maxHeight: EDITOR_OUTLINE_MAX_WITH_KEYBOARD } : null,
            ]}
          >
            {outlinePanel}
          </ScrollView>
        )}

        {editing ? (
          // outside any ScrollView: a growing input inside one does not follow the caret
          <View style={{ flex: 1, paddingHorizontal: spacing.xxl, paddingTop: spacing.lg }}>
            <TextInput
              testID="editor-input"
              multiline
              // the field has a fixed height and scrolls itself: a native
              // multiline input keeps the line with the caret in view
              scrollEnabled
              autoFocus
              value={draft}
              onChangeText={(next) => {
                setDraft(next);
                setSelectionHint('');
                controller.editDraft(next);
              }}
              onSelectionChange={({ nativeEvent }) => {
                const { start, end } = nativeEvent.selection;
                setSelection(end > start ? { from: start, to: end } : null);
                setSelectionHint('');
              }}
              style={{
                color: colors.text,
                fontFamily: fonts.body,
                fontSize: typeScale.bodyLarge,
                lineHeight: Math.round(typeScale.bodyLarge * 1.6),
                flex: 1,
                textAlignVertical: 'top',
              }}
            />
          </View>
        ) : (
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
        )}

        {controller.refineFailed ? (
          // outside the scroll: on a long chapter a message at the bottom of the
          // text was never seen, and the failure looked silent
          <View
            testID="editor-refine-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={[
              styles.errorBanner,
              {
                marginHorizontal: spacing.xl,
                marginBottom: spacing.sm,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderColor: colors.accent,
                gap: spacing.md,
              },
            ]}
          >
            <Ionicons name="alert-circle-outline" size={18} color={colors.accentText} />
            <Text
              style={{
                flex: 1,
                color: colors.text,
                fontFamily: fonts.body,
                fontSize: typeScale.caption,
              }}
            >
              {controller.refineErrorMessage}
            </Text>
            {controller.refineErrorRetryable ? (
              <Chip
                label={t('common.retry')}
                tone="green"
                testID="editor-refine-retry"
                onPress={() => {
                  flushDraft();
                  void controller.retryRefine();
                }}
              />
            ) : null}
          </View>
        ) : null}

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
              style={{
                color: colors.textMuted,
                fontFamily: fonts.body,
                fontSize: typeScale.caption,
              }}
            >
              {t('review.editor.freeKeyBody')}
            </Text>
          </View>
        )}

        <View
          testID="editor-toolbar"
          style={[
            styles.toolbar,
            {
              borderTopColor: colors.hairline,
              paddingHorizontal: spacing.xl,
              paddingTop: selectionHint !== '' ? spacing.sm : spacing.lg,
              paddingBottom: panelBottom,
              gap: spacing.sm,
            },
          ]}
        >
          {selectionHint !== '' ? (
            <Text
              testID="editor-selection-hint"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              numberOfLines={2}
              style={{
                color: colors.accentText,
                fontFamily: fonts.body,
                fontSize: typeScale.caption,
              }}
            >
              {selectionHint}
            </Text>
          ) : null}
          {controller.refining ? (
            <Text
              testID="editor-refine-status"
              accessibilityLiveRegion="polite"
              style={{
                color: colors.textMutedStrong,
                fontFamily: fonts.bodyItalic,
                fontSize: typeScale.caption,
              }}
            >
              {t('review.editor.refiningStatus')}
            </Text>
          ) : controller.refineEmptyMessage !== '' ? (
            <Text
              testID="editor-refine-empty"
              accessibilityLiveRegion="polite"
              style={{ color: colors.text, fontFamily: fonts.body, fontSize: typeScale.caption }}
            >
              {controller.refineEmptyMessage}
            </Text>
          ) : null}
          <View style={[styles.panel, { gap: spacing.md }]}>
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
                label={
                  controller.refining
                    ? t('review.editor.refining')
                    : selection !== null
                      ? t('review.editor.refineSelection')
                      : t('review.editor.refine')
                }
                disabled={
                  controller.refining ||
                  (editing && selection === null) ||
                  controller.loadState !== 'ready' ||
                  (controller.text === '' && !editing)
                }
                onPress={() => {
                  if (editing && selection !== null) {
                    void refineSelection(selection);
                    return;
                  }
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
        </View>
      </View>
    </Screen>
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
  header: { flexDirection: 'row', alignItems: 'center' },
  headerText: { flex: 1, gap: 2 },
  textArea: { flex: 1 },
  outlineRoom: { flexGrow: 0, flexShrink: 0 },
  toolbar: { borderTopWidth: 1 },
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  refineButton: { flex: 1 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 8 },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
