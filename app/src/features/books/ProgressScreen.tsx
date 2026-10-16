/**
 * Progress screen: the EXTENDED version of the motivational nudge. Numbers
 * and habit, not content: today's goal ring, STREAK card (consecutive days
 * above the goal, computeStreak), week strip with checkmarks, bar chart of
 * the last 7 days and the most recent book row.
 *
 * It is reached from the "Today's goal" card in the Library (which stays
 * there, smaller). Domain rules: the UI depends ONLY on repositories via
 * props, never on the Firebase SDK; it uses only theme tokens and the
 * components in components/. No new service: progress/settings/books are reused.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, OrnamentDivider } from '../../components';
import { formatNumber } from '../../lib/text';
import { t, tn } from '../../i18n';
import { useTheme } from '../../theme';
import type { SettingsRepository } from '../settings';
import { BOOK_TARGET_WORDS } from './LibraryScreen';
import { MAX_HISTORY_DAYS } from './dailyProgress';
import type { DailyProgress, DailyProgressRepository } from './dailyProgress';
import type { Book, BookRepository } from './types';

/** Days shown in the week strip and the bar chart. */
const WEEK_DAYS = 7;

export interface ProgressScreenProps {
  dailyProgressRepository: DailyProgressRepository;
  settingsRepository: SettingsRepository;
  bookRepository: BookRepository;
  onBack: () => void;
}

/** Initial of the weekday (S M T W T F S, in the UI language) from the YYYY-MM-DD key. */
function weekdayInitial(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return t('books.weekdayInitials')[new Date(year, month - 1, day).getDay()];
}

/**
 * Progress ring without graphics dependencies (no SVG in the project):
 * two filled half-circles rotating around the center reveal the reached
 * portion; a "hole" circle in the middle carves out the donut and hosts the numbers.
 * Pixel fidelity is secondary: what matters is that the ring fills as it
 * approaches the goal.
 */
function GoalRing({
  size,
  stroke,
  progress,
  trackColor,
  fillColor,
  holeColor,
  children,
}: {
  size: number;
  stroke: number;
  progress: number;
  trackColor: string;
  fillColor: string;
  holeColor: string;
  children: React.ReactNode;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const half = size / 2;
  const firstDeg = Math.min(p, 0.5) * 360; // right half: 0..180
  const secondDeg = Math.max(p - 0.5, 0) * 360; // left half: 0..180

  const sweep = (side: 'right' | 'left', deg: number) => {
    const bulgeRight = side === 'right';
    const semicircle: StyleProp<ViewStyle> = {
      position: 'absolute',
      top: 0,
      left: 0,
      width: half,
      height: size,
      backgroundColor: fillColor,
      // flat side toward the ring center, bulge toward the outside
      borderTopRightRadius: bulgeRight ? half : 0,
      borderBottomRightRadius: bulgeRight ? half : 0,
      borderTopLeftRadius: bulgeRight ? 0 : half,
      borderBottomLeftRadius: bulgeRight ? 0 : half,
      transformOrigin: bulgeRight ? 'left center' : 'right center',
      transform: [{ rotate: `${180 - deg}deg` }],
    };
    return (
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: bulgeRight ? half : 0,
          width: half,
          height: size,
          overflow: 'hidden',
        }}
      >
        <View style={semicircle} />
      </View>
    );
  };

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: half,
          borderWidth: stroke,
          borderColor: trackColor,
        }}
      />
      {sweep('right', firstDeg)}
      {sweep('left', secondDeg)}
      <View
        style={{
          position: 'absolute',
          top: stroke,
          left: stroke,
          right: stroke,
          bottom: stroke,
          borderRadius: half - stroke,
          backgroundColor: holeColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function ProgressScreen({
  dailyProgressRepository,
  settingsRepository,
  bookRepository,
  onBack,
}: ProgressScreenProps) {
  const { colors, fonts, spacing, radius, typeScale, letterSpacing } = useTheme();

  const [goal, setGoal] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [history, setHistory] = useState<DailyProgress[] | null>(null);
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    return bookRepository.observeBooks(
      (next) => setBook(next[0] ?? null),
      () => setBook(null),
    );
  }, [bookRepository]);

  useEffect(() => {
    let cancelled = false;
    // the streak depends on the goal (Settings): once loaded, it is
    // reconciled and persisted with the unpruned counter (can exceed 35 days)
    settingsRepository
      .load()
      .then((settings) => {
        if (cancelled) return undefined;
        setGoal(settings.dailyGoalWords);
        return dailyProgressRepository.getStreak(settings.dailyGoalWords);
      })
      .then((value) => {
        if (!cancelled && value !== undefined) setStreak(value);
      })
      .catch(() => {
        if (!cancelled) setGoal(null);
      });
    // history for week and chart: pruned to the last MAX_HISTORY_DAYS
    dailyProgressRepository
      .getHistory(MAX_HISTORY_DAYS)
      .then((days) => {
        if (!cancelled) setHistory(days);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settingsRepository, dailyProgressRepository]);

  // buildHistory always returns MAX_HISTORY_DAYS entries: here it is enough to exclude the
  // loading state (history === null); the real empty state (zero books) is
  // handled by the book row, which appears only if there is a book.
  const view = useMemo(() => {
    if (history === null) return null;
    const today = history[history.length - 1];
    const week = history.slice(-WEEK_DAYS);
    const barMax = Math.max(goal ?? 0, ...week.map((d) => d.words), 1);
    return { today, week, barMax };
  }, [history, goal]);

  const sectionLabelStyle = {
    color: colors.textMuted,
    fontFamily: fonts.bodySemiBold,
    fontSize: typeScale.label,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase' as const,
  };

  const reached = (words: number) => goal !== null && words >= goal;

  return (
    <SafeAreaView
      testID="progress-screen"
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { paddingHorizontal: spacing.lg }]}>
        <Pressable
          testID="progress-back"
          accessibilityRole="button"
          accessibilityLabel={t('books.backToLibrary')}
          onPress={onBack}
          style={styles.iconButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text
          style={{
            flex: 1,
            fontFamily: fonts.display,
            fontSize: typeScale.title,
            color: colors.text,
          }}
        >
          {t('books.progressTitle')}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {view !== null && (
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.xl, paddingTop: spacing.md }}>
          {/* Today's goal ring */}
          <View style={{ alignItems: 'center', gap: spacing.sm }} testID="progress-ring">
            <GoalRing
              size={188}
              stroke={16}
              progress={goal !== null && goal > 0 ? view.today.words / goal : 0}
              trackColor={colors.track}
              fillColor={colors.primary}
              holeColor={colors.background}
            >
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: typeScale.display,
                  color: colors.text,
                }}
              >
                {formatNumber(view.today.words)}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: typeScale.bodySmall,
                  color: colors.textMuted,
                }}
              >
                {goal !== null
                  ? t('books.ofGoalWords', { goal: formatNumber(goal) })
                  : t('books.wordsToday')}
              </Text>
            </GoalRing>
          </View>

          {/* Streak */}
          <Card
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
            testID="progress-streak"
          >
            <Ionicons name="flame" size={26} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: typeScale.heading,
                  color: colors.text,
                }}
              >
                {tn('books.streakDays', streak, { formatted: formatNumber(streak) })}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.bodyItalic,
                  fontSize: typeScale.caption,
                  color: colors.textMuted,
                }}
              >
                {streak === 0 ? t('books.streakZero') : t('books.streakSome')}
              </Text>
            </View>
          </Card>

          {/* Week strip: checkmark if the goal is met, today circled in gold */}
          <View style={{ gap: spacing.sm }}>
            <Text style={sectionLabelStyle}>{t('books.thisWeek')}</Text>
            <View style={styles.weekRow} testID="progress-week">
              {view.week.map((day, index) => {
                const isToday = index === view.week.length - 1;
                const ok = reached(day.words);
                return (
                  <View key={day.date} style={{ alignItems: 'center', gap: spacing.xs }}>
                    <Text
                      style={{
                        fontFamily: fonts.body,
                        fontSize: typeScale.micro,
                        color: colors.textMuted,
                      }}
                    >
                      {weekdayInitial(day.date)}
                    </Text>
                    <View
                      testID={`progress-day-${day.date}`}
                      accessibilityValue={{ text: ok ? t('books.reached') : t('books.notReached') }}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: ok ? colors.primary : colors.track,
                        borderWidth: isToday ? 2 : 0,
                        borderColor: colors.accent,
                      }}
                    >
                      {ok ? (
                        <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
                      ) : (
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: colors.textMuted,
                          }}
                        />
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Bar chart of the last 7 days */}
          <View style={{ gap: spacing.sm }}>
            <Text style={sectionLabelStyle}>{t('books.last7Days')}</Text>
            <View style={styles.barsRow}>
              {view.week.map((day) => {
                const fraction = Math.max(0.02, day.words / view.barMax);
                return (
                  <View key={day.date} style={{ flex: 1, alignItems: 'center', gap: spacing.xs }}>
                    <View
                      testID={`progress-bar-${day.date}`}
                      style={{ height: 96, width: 12, justifyContent: 'flex-end' }}
                    >
                      <View
                        style={{
                          height: `${Math.min(1, fraction) * 100}%`,
                          width: 12,
                          borderRadius: radius.sharp,
                          backgroundColor: reached(day.words)
                            ? colors.primary
                            : colors.hairlineGold,
                        }}
                      />
                    </View>
                    <Text
                      style={{
                        fontFamily: fonts.body,
                        fontSize: typeScale.micro,
                        color: colors.textMuted,
                      }}
                    >
                      {weekdayInitial(day.date)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Most recent book row */}
          {book !== null && (
            <Card style={{ gap: spacing.sm }} testID="progress-book">
              <Text style={sectionLabelStyle}>{t('books.yourBook')}</Text>
              <Text
                numberOfLines={2}
                style={{
                  fontFamily: fonts.display,
                  fontSize: typeScale.heading,
                  color: colors.text,
                }}
              >
                {book.title}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.body,
                  fontSize: typeScale.bodySmall,
                  color: colors.text,
                }}
              >
                {`${tn('books.chapters', book.chapterCount, { formatted: formatNumber(book.chapterCount) })} · ${tn('books.words', book.wordCount, { formatted: formatNumber(book.wordCount) })}`}
              </Text>
              <View
                style={{
                  height: 5,
                  backgroundColor: colors.track,
                  borderRadius: radius.sharp,
                  overflow: 'hidden',
                  marginTop: spacing.xs,
                }}
              >
                <View
                  style={{
                    width: `${Math.min(1, book.wordCount / BOOK_TARGET_WORDS) * 100}%`,
                    height: 5,
                    backgroundColor: colors.accent,
                    borderRadius: radius.sharp,
                  }}
                />
              </View>
            </Card>
          )}

          <OrnamentDivider style={{ alignSelf: 'center', width: 160 }} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
});
