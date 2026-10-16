/**
 * Library screen: bookin3voice title page with an ornament, "Today's goal"
 * card (dailyGoalWords from the Settings screen + words added today), list of
 * books as bound volumes with progress from the denormalized counters (ONLY
 * the book documents are read) and a "+ New book" FAB. The gear icon at the
 * top opens Settings.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, OrnamentDivider, PrimaryButton } from '../../components';
import { formatNumber } from '../../lib/text';
import { t, tn, uiLocale } from '../../i18n';
import { useTheme } from '../../theme';
import type { SettingsRepository } from '../settings';
import type { DailyProgressRepository } from './dailyProgress';
import type { Book, BookRepository } from './types';

/**
 * Indicative target of a book (typical novel), used ONLY for the card's
 * progress bar: a per-book targetWords field is a product decision (for now
 * it is not in the schema).
 */
export const BOOK_TARGET_WORDS = 60_000;

export interface LibraryScreenProps {
  bookRepository: BookRepository;
  settingsRepository: SettingsRepository;
  dailyProgressRepository: DailyProgressRepository;
  onOpenBook: (book: Book) => void;
  onOpenSettings: () => void;
  /** Opens the Progress diary (extended version of the goal card). */
  onOpenProgress: () => void;
}

/** Start month in Italian for the meta row ("Romanzo · iniziato a giugno"). */
function startedLabel(createdAtMillis: number): string {
  try {
    const month = new Intl.DateTimeFormat(uiLocale(), { month: 'long' }).format(
      new Date(createdAtMillis),
    );
    return t('books.startedIn', { month });
  } catch {
    return t('books.inProgressShort');
  }
}

export function LibraryScreen({
  bookRepository,
  settingsRepository,
  dailyProgressRepository,
  onOpenBook,
  onOpenSettings,
  onOpenProgress,
}: LibraryScreenProps) {
  const { colors, fonts, spacing, radius, typeScale, letterSpacing } = useTheme();

  const [books, setBooks] = useState<Book[] | null>(null);
  const [listError, setListError] = useState(false);
  const [dailyGoal, setDailyGoal] = useState<number | null>(null);
  const [todayWords, setTodayWords] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    return bookRepository.observeBooks(
      (next) => {
        setListError(false);
        setBooks(next);
      },
      () => setListError(true),
    );
  }, [bookRepository]);

  // goal of the day: settings + local word counter
  useEffect(() => {
    let cancelled = false;
    settingsRepository
      .load()
      .then((settings) => {
        if (cancelled) return;
        setDailyGoal(settings.dailyGoalWords);
        // reconciles the streak when the Library opens (not shown here):
        // keeps the unpruned counter fresh so it does not restart when opening Progress
        dailyProgressRepository.getStreak(settings.dailyGoalWords).catch(() => {});
      })
      .catch(() => {
        // without readable settings the goal card stays hidden
      });
    dailyProgressRepository
      .getToday()
      .then((progress) => {
        if (!cancelled) setTodayWords(progress.words);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settingsRepository, dailyProgressRepository]);

  const createBook = () => {
    const title = newTitle.trim();
    if (title === '') return;
    setCreating(false);
    setNewTitle('');
    bookRepository
      .createBook({ title })
      .then((book) => onOpenBook(book))
      .catch(() => setListError(true));
  };

  const sectionLabelStyle = {
    color: colors.textMuted,
    fontFamily: fonts.bodySemiBold,
    fontSize: typeScale.label,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase' as const,
  };

  const inProgress = (books ?? []).filter((book) => book.status !== 'final').length;

  const renderBook = ({ item, index }: { item: Book; index: number }) => {
    const coverColor = index % 2 === 0 ? colors.coverGreen : colors.coverLeather;
    const progress = Math.min(1, item.wordCount / BOOK_TARGET_WORDS);
    return (
      <Pressable
        accessibilityRole="button"
        testID={`library-book-${item.id}`}
        onPress={() => onOpenBook(item)}
      >
        <Card style={{ flexDirection: 'row', gap: spacing.lg }}>
          <View
            style={{
              width: 92,
              height: 130,
              backgroundColor: coverColor,
              borderRadius: radius.cover,
              borderWidth: 1,
              borderColor: colors.accentLight,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: spacing.sm + 2,
            }}
          >
            <Text
              numberOfLines={4}
              style={{
                fontFamily: fonts.display,
                fontSize: typeScale.bodySmall,
                color: colors.accentLight,
                textAlign: 'center',
                lineHeight: typeScale.bodySmall * 1.35,
              }}
            >
              {item.title}
            </Text>
          </View>
          <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xs + 2 }}>
            <Text
              numberOfLines={2}
              style={{
                fontFamily: fonts.display,
                fontSize: typeScale.heading,
                color: colors.text,
              }}
            >
              {item.title}
            </Text>
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: typeScale.caption,
                color: colors.textMuted,
              }}
            >
              {`${item.genre === '' ? t('books.defaultGenre') : item.genre} · ${startedLabel(item.createdAt)}`}
            </Text>
            <Text
              style={{ fontFamily: fonts.body, fontSize: typeScale.bodySmall, color: colors.text }}
            >
              {`${tn('books.chapters', item.chapterCount, { formatted: formatNumber(item.chapterCount) })} · ${tn('books.words', item.wordCount, { formatted: formatNumber(item.wordCount) })}`}
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
                  width: `${progress * 100}%`,
                  height: 5,
                  backgroundColor: colors.accent,
                  borderRadius: radius.sharp,
                }}
              />
            </View>
          </View>
        </Card>
      </Pressable>
    );
  };

  return (
    <SafeAreaView
      testID="library-screen"
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
        <View style={styles.headerRow}>
          <View style={{ width: 40 }} />
          <Text
            style={{
              flex: 1,
              textAlign: 'center',
              fontFamily: fonts.display,
              fontSize: typeScale.display,
              letterSpacing: letterSpacing.display,
              color: colors.text,
            }}
          >
            bookin3voice
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('books.settings')}
            testID="library-settings"
            onPress={onOpenSettings}
            style={styles.iconButton}
          >
            <Ionicons name="settings-outline" size={22} color={colors.textMutedStrong} />
          </Pressable>
        </View>
        <OrnamentDivider prominent style={{ alignSelf: 'center', width: 180 }} />

        {dailyGoal !== null && (
          <Pressable
            testID="library-goal-open"
            accessibilityRole="button"
            accessibilityLabel={t('books.openProgress')}
            onPress={onOpenProgress}
          >
            <Card style={{ marginTop: spacing.xl, gap: spacing.sm + 2 }} testID="library-goal">
              <View style={styles.goalHeader}>
                <Text style={sectionLabelStyle}>{t('books.todayGoal')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View
                  style={{
                    flex: 1,
                    height: 6,
                    backgroundColor: colors.track,
                    borderRadius: radius.sharp,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min(1, todayWords / dailyGoal) * 100}%`,
                      height: 6,
                      backgroundColor: colors.primary,
                      borderRadius: radius.sharp,
                    }}
                  />
                </View>
                <Text
                  style={{
                    fontFamily: fonts.body,
                    fontSize: typeScale.bodySmall,
                    color: colors.text,
                  }}
                >
                  {t('books.goalProgress', {
                    today: formatNumber(todayWords),
                    goal: formatNumber(dailyGoal),
                  })}
                </Text>
              </View>
            </Card>
          </Pressable>
        )}

        <View style={[styles.sectionRow, { marginTop: spacing.xxl, marginBottom: spacing.sm }]}>
          <Text style={sectionLabelStyle}>{t('books.yourBooks')}</Text>
          {books !== null && books.length > 0 && (
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: typeScale.caption,
                color: colors.textMuted,
              }}
            >
              {t('books.inProgressCount', { count: inProgress })}
            </Text>
          )}
        </View>
      </View>

      {listError && (
        <Text
          style={{
            paddingHorizontal: spacing.xl,
            color: colors.textMutedStrong,
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
          }}
        >
          {t('books.listError')}
        </Text>
      )}

      <FlatList
        data={books ?? []}
        keyExtractor={(book) => book.id}
        renderItem={renderBook}
        contentContainerStyle={{
          paddingHorizontal: spacing.xl,
          paddingBottom: 110,
          gap: spacing.lg,
        }}
        ListEmptyComponent={
          books === null ? null : (
            <Card style={{ alignItems: 'center', gap: spacing.sm }}>
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: typeScale.heading,
                  color: colors.text,
                }}
              >
                {t('books.emptyTitle')}
              </Text>
              <Text
                style={{
                  fontFamily: fonts.bodyItalic,
                  fontSize: typeScale.bodySmall,
                  color: colors.textMuted,
                  textAlign: 'center',
                }}
              >
                {t('books.emptyBody')}
              </Text>
            </Card>
          )
        }
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('books.newBook')}
        testID="library-fab"
        onPress={() => setCreating(true)}
        style={{
          position: 'absolute',
          right: spacing.xxl,
          bottom: spacing.xxl + 4,
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 12,
          shadowOpacity: 1,
          elevation: 6,
        }}
      >
        <Ionicons name="add" size={30} color={colors.onAccent} />
      </Pressable>

      <Modal
        visible={creating}
        transparent
        animationType="fade"
        onRequestClose={() => setCreating(false)}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: colors.shadow }]}>
          <Card style={{ width: '100%', maxWidth: 340, gap: spacing.lg }}>
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: typeScale.title,
                color: colors.text,
                textAlign: 'center',
              }}
            >
              {t('books.newBook')}
            </Text>
            <OrnamentDivider />
            <TextInput
              testID="library-new-book-title"
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder={t('books.bookTitlePlaceholder')}
              placeholderTextColor={colors.textMuted}
              autoFocus
              style={{
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: radius.sharp,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm + 2,
                fontFamily: fonts.body,
                fontSize: typeScale.body,
                color: colors.text,
                backgroundColor: colors.background,
              }}
            />
            <PrimaryButton
              label={t('books.createBook')}
              testID="library-new-book-create"
              disabled={newTitle.trim() === ''}
              onPress={createBook}
            />
            <Pressable
              accessibilityRole="button"
              testID="library-new-book-cancel"
              onPress={() => {
                setCreating(false);
                setNewTitle('');
              }}
              style={{ alignSelf: 'center', padding: spacing.xs }}
            >
              <Text
                style={{
                  fontFamily: fonts.bodyItalic,
                  fontSize: typeScale.bodySmall,
                  color: colors.textMutedStrong,
                }}
              >
                {t('books.cancel')}
              </Text>
            </Pressable>
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
