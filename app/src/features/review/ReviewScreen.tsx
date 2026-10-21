/**
 * Suggestion review: original→proposal cards
 * with category and one-line rationale; for style up to 3 selectable
 * variants (tap = choose), for grammar/pacing a single proposal; history
 * cards name their aspect (period detail or possible anachronism) and always
 * say they are a hint to check, never a certain fact; swipe
 * right = accept, left = reject (same commands as the round buttons);
 * category filters with «accept all»; «Annulla» on the last command
 * (Command pattern with undo).
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Card, Chip, Screen, useBottomClearance } from '../../components';
import type { ChipTone } from '../../components';
import { t, tn } from '../../i18n';
import { useTheme } from '../../theme';
import { HISTORY_ASPECT_LABELS, KIND_LABELS, SUGGESTION_KINDS } from './types';
import type { Suggestion, SuggestionKind } from './types';
import type { ChapterReviewController } from './useChapterReview';

export interface ReviewScreenProps {
  controller: ChapterReviewController;
  /** E.g. "Capitolo VII". */
  chapterLabel?: string;
  onBack: () => void;
  /** The chapter's key beats (OutlineTrack), under the header. */
  outlinePanel?: ReactNode;
}

export function ReviewScreen({
  controller,
  chapterLabel,
  onBack,
  outlinePanel,
}: ReviewScreenProps) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  const footerBottom = useBottomClearance(spacing.md);
  const [filter, setFilter] = useState<'all' | SuggestionKind>('all');

  const pending = controller.suggestions.filter((s) => s.state === 'pending');
  const visible = filter === 'all' ? pending : pending.filter((s) => s.kind === filter);

  return (
    <Screen testID="review-screen">
      <View
        style={[
          styles.header,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          testID="review-back"
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text
            style={{ color: colors.text, fontFamily: fonts.display, fontSize: typeScale.title }}
          >
            {t('review.screen.title')}
          </Text>
          <Text
            testID="review-subtitle"
            style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: typeScale.caption }}
          >
            {chapterLabel ? `${chapterLabel} · ` : ''}
            {t('review.screen.pending', { count: pending.length })}
          </Text>
        </View>
      </View>

      {outlinePanel}

      <View
        style={[
          styles.filters,
          { paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.md },
        ]}
      >
        <Chip
          label={t('review.screen.all')}
          selected={filter === 'all'}
          onPress={() => setFilter('all')}
          testID="review-filter-all"
        />
        {SUGGESTION_KINDS.map((kind) => (
          <Chip
            key={kind}
            label={KIND_LABELS[kind]}
            selected={filter === kind}
            onPress={() => setFilter(kind)}
            testID={`review-filter-${kind}`}
          />
        ))}
      </View>

      {controller.acceptNotice !== '' ? (
        // above the list: a message at the bottom of the cards would go unseen
        <Text
          testID="review-accept-notice"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{
            color: colors.accentText,
            fontFamily: fonts.body,
            fontSize: typeScale.caption,
            textAlign: 'center',
            paddingHorizontal: spacing.xl,
            paddingBottom: spacing.md,
          }}
        >
          {controller.acceptNotice}
        </Text>
      ) : null}

      {filter === 'history' && visible.length > 0 ? (
        <Text
          style={{
            paddingHorizontal: spacing.xl,
            paddingBottom: spacing.md,
            color: colors.history,
            fontFamily: fonts.body,
            fontSize: typeScale.label,
          }}
          testID="review-history-one-by-one"
        >
          {t('review.history.oneByOne')}
        </Text>
      ) : null}
      {filter !== 'all' && filter !== 'history' && visible.length > 0 ? (
        <View style={{ paddingHorizontal: spacing.xl, paddingBottom: spacing.md }}>
          <Chip
            label={t('review.screen.acceptAll', { count: visible.length })}
            tone="green"
            onPress={() => void controller.acceptAll(filter)}
            testID="review-accept-all"
          />
        </View>
      ) : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.xl,
          gap: spacing.md + 2,
        }}
      >
        {visible.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            text={controller.text}
            onAccept={(proposalIndex) => void controller.accept(suggestion.id, proposalIndex)}
            onReject={() => void controller.reject(suggestion.id)}
          />
        ))}
        {visible.length === 0 ? (
          <Text
            testID="review-empty"
            style={{
              color: colors.textMuted,
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.body,
              textAlign: 'center',
              paddingTop: spacing.xxxl,
            }}
          >
            {t('review.screen.empty')}
          </Text>
        ) : null}
        {controller.staleCount > 0 ? (
          <Text
            testID="review-stale-note"
            style={{
              color: colors.textMuted,
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.caption,
              textAlign: 'center',
            }}
          >
            {tn('review.screen.stale', controller.staleCount)}
          </Text>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            borderTopColor: colors.hairline,
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.md,
            paddingBottom: footerBottom,
            gap: spacing.sm,
          },
        ]}
      >
        {controller.canUndo ? (
          <Chip
            label={t('review.screen.undo')}
            tone="gold"
            onPress={() => void controller.undo()}
            testID="review-undo"
          />
        ) : null}
        <Text
          style={{
            color: colors.textMuted,
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
            textAlign: 'center',
          }}
        >
          {t('review.screen.swipeHint')}
        </Text>
      </View>
    </Screen>
  );
}

const SWIPE_THRESHOLD = 96;
const VARIANT_LETTERS = ['A', 'B', 'C'] as const;

/** Category tag colour on the card: history stands apart from the craft kinds. */
const KIND_TONES: Record<SuggestionKind, ChipTone> = {
  style: 'gold',
  grammar: 'green',
  pacing: 'gold',
  history: 'history',
};

function SuggestionCard({
  suggestion,
  text,
  onAccept,
  onReject,
}: {
  suggestion: Suggestion;
  text: string;
  onAccept: (proposalIndex: number) => void;
  onReject: () => void;
}) {
  const { colors, fonts, spacing, typeScale, radius, letterSpacing } = useTheme();
  const [selected, setSelected] = useState(0);
  const translateX = useMemo(() => new Animated.Value(0), []);

  // recreated when handlers or the chosen variant change: never mid-gesture
  // (the variant is chosen with a tap, not during the swipe)
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_event, gesture) => translateX.setValue(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx > SWIPE_THRESHOLD) {
            onAccept(selected);
          } else if (gesture.dx < -SWIPE_THRESHOLD) {
            onReject();
          }
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [translateX, onAccept, onReject, selected],
  );

  const line = text.slice(0, suggestion.span.from).split('\n').length;
  const tone = KIND_TONES[suggestion.kind];
  const isHistory = suggestion.kind === 'history';
  const hasVariants = suggestion.proposals.length > 1;

  return (
    <Animated.View
      style={{ transform: [{ translateX }] }}
      {...panResponder.panHandlers}
      testID={`review-card-${suggestion.id}`}
    >
      <Card style={{ gap: spacing.sm + 2 }}>
        <View style={styles.cardHeader}>
          <View style={[styles.cardTag, { gap: spacing.sm }]}>
            <Chip label={KIND_LABELS[suggestion.kind]} tone={tone} uppercase />
            {suggestion.aspect ? (
              <Text
                testID={`review-aspect-${suggestion.id}`}
                style={{ color: colors.history, fontFamily: fonts.body, fontSize: typeScale.label }}
              >
                {HISTORY_ASPECT_LABELS[suggestion.aspect]}
              </Text>
            ) : null}
          </View>
          <Text
            style={{ color: colors.textMuted, fontFamily: fonts.body, fontSize: typeScale.label }}
          >
            {t('review.card.line', { line })}
          </Text>
        </View>

        {hasVariants ? (
          <>
            <Text
              testID={`review-original-${suggestion.id}`}
              style={{
                color: colors.textMuted,
                fontFamily: fonts.body,
                fontSize: typeScale.body,
                textDecorationLine: 'line-through',
              }}
            >
              {suggestion.original}
            </Text>
            <Text
              style={{
                color: colors.textMuted,
                fontFamily: fonts.body,
                fontSize: typeScale.micro,
                letterSpacing: letterSpacing.tag,
                textTransform: 'uppercase',
              }}
            >
              {t('review.card.variants', { count: suggestion.proposals.length })}
            </Text>
            <View style={{ gap: spacing.sm }}>
              {suggestion.proposals.map((proposal, index) => {
                const isSelected = index === selected;
                return (
                  <Pressable
                    key={index}
                    accessibilityRole="button"
                    onPress={() => setSelected(index)}
                    testID={`review-variant-${suggestion.id}-${index}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm + 2,
                      borderWidth: isSelected ? 1.5 : 1,
                      borderColor: isSelected ? colors.primary : colors.hairline,
                      backgroundColor: isSelected ? colors.selectedTint : 'transparent',
                      borderRadius: radius.sharp,
                      paddingVertical: spacing.sm + 1,
                      paddingHorizontal: spacing.md,
                    }}
                  >
                    <View
                      style={[
                        styles.variantBadge,
                        isSelected
                          ? { backgroundColor: colors.accent }
                          : { borderWidth: 1, borderColor: colors.accent },
                      ]}
                    >
                      <Text
                        style={{
                          color: isSelected ? colors.onAccent : colors.accentText,
                          fontFamily: fonts.body,
                          fontSize: typeScale.label,
                        }}
                      >
                        {VARIANT_LETTERS[index] ?? String(index + 1)}
                      </Text>
                    </View>
                    <Text
                      style={{
                        flex: 1,
                        color: colors.text,
                        fontFamily: fonts.body,
                        fontSize: typeScale.body,
                      }}
                    >
                      {proposal}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View style={[styles.singleProposal, { gap: spacing.sm + 2 }]}>
            <Text
              testID={`review-original-${suggestion.id}`}
              style={{
                color: colors.textMuted,
                fontFamily: fonts.body,
                fontSize: typeScale.body,
                textDecorationLine: 'line-through',
                flexShrink: 1,
              }}
            >
              {suggestion.original}
            </Text>
            <Ionicons name="arrow-forward" size={16} color={colors.accent} />
            <Text
              testID={`review-proposal-${suggestion.id}`}
              style={{
                color: colors.text,
                fontFamily: fonts.bodySemiBold,
                fontSize: typeScale.body,
                flexShrink: 1,
              }}
            >
              {suggestion.proposals[0]}
            </Text>
          </View>
        )}

        <Text
          testID={`review-rationale-${suggestion.id}`}
          numberOfLines={isHistory ? 3 : 1}
          style={{
            color: colors.textMutedStrong,
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
          }}
        >
          {suggestion.rationale}
        </Text>
        {isHistory ? (
          <Text
            testID={`review-to-check-${suggestion.id}`}
            style={{
              color: colors.textMutedStrong,
              fontFamily: fonts.body,
              fontSize: typeScale.micro,
            }}
          >
            {t('review.history.toCheck')}
          </Text>
        ) : null}

        <View style={[styles.actions, { gap: spacing.md }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('review.card.reject')}
            onPress={onReject}
            testID={`review-reject-${suggestion.id}`}
            style={[styles.actionButton, { borderWidth: 1, borderColor: colors.hairlineGold }]}
          >
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('review.card.accept')}
            onPress={() => onAccept(selected)}
            testID={`review-accept-${suggestion.id}`}
            style={[styles.actionButton, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
          </Pressable>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 2 },
  filters: { flexDirection: 'row', flexWrap: 'wrap' },
  list: { flex: 1 },
  footer: { borderTopWidth: 1, alignItems: 'center' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTag: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  singleProposal: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  actionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
