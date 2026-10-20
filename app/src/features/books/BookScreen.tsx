/**
 * Book screen: header with title and denormalized counters, three tabs.
 * *Chapters*: ordered list with Roman numeral, color-coded status
 * (draft/refined/final), word count, mic on the row (→ Dictation) and tap on
 * the row (→ Editor); reordering with long press (up/down arrows — real
 * drag & drop will arrive with a gesture library); "+ New chapter" at the end.
 * *Synopsis*: synopsis + generated outline with corkboard preview
 * (features/outline). *Export*: KDP metadata, format and generation with the
 * share sheet (features/export).
 * On open, the self-healing reconciliation of the counters starts.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ArchesFill,
  Card,
  OrnamentDivider,
  PrimaryButton,
  RomanNumeral,
  Screen,
  useBottomClearance,
} from '../../components';
import { formatNumber } from '../../lib/text';
import { t, tn } from '../../i18n';
import { useTheme } from '../../theme';
import type { ChapterRepository, ChapterStatus, ChapterSummary } from '../chapters';
import { ExportTab } from '../export';
import type { BookExportService, ExportFileSink, PendingSuggestionsRepository } from '../export';
import { SynopsisTab } from '../outline';
import type { OutlineDraftRepository, OutlineService } from '../outline';
import type { SettingsRepository } from '../settings';
import { StylePicker } from './StylePicker';
import type { Book, BookRepository } from './types';

export interface BookScreenProps {
  bookId: string;
  bookRepository: BookRepository;
  chapterRepository: ChapterRepository;
  exportService: BookExportService;
  pendingSuggestions: PendingSuggestionsRepository;
  exportFileSink: ExportFileSink;
  /** Waits for local writes to reach the server before an export. */
  waitForSync?: () => Promise<boolean>;
  outlineService: OutlineService;
  /** Keeps the unconfirmed outline preview across tabs; default on the device. */
  outlineDrafts?: OutlineDraftRepository;
  /** Read for the author name the Export tab offers to a book without one. */
  settingsRepository?: SettingsRepository;
  onBack: () => void;
  /** Tap on the row: opens the chapter Editor. `position` is 1-based. */
  onOpenChapter: (chapter: ChapterSummary, position: number) => void;
  /** Mic on the row: opens Dictation on that chapter. `position` is 1-based. */
  onDictateChapter: (chapter: ChapterSummary, position: number) => void;
  /** Header action: opens the book's Notebook. Receives the title. */
  onOpenNotes?: (bookTitle: string) => void;
}

type BookTab = 'chapters' | 'synopsis' | 'export';

const statusLabel = (status: ChapterStatus): string => t(`books.status_${status}`);

export function BookScreen({
  bookId,
  bookRepository,
  chapterRepository,
  exportService,
  pendingSuggestions,
  exportFileSink,
  waitForSync,
  outlineService,
  outlineDrafts,
  settingsRepository,
  onBack,
  onOpenChapter,
  onDictateChapter,
  onOpenNotes,
}: BookScreenProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();
  // the footer already has its own padding: the list only adds the system inset
  const listBottom = useBottomClearance(0);

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [tab, setTab] = useState<BookTab>('chapters');
  const [reordering, setReordering] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [defaultAuthor, setDefaultAuthor] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (settingsRepository === undefined) return undefined;
    let cancelled = false;
    settingsRepository
      .load()
      .then((settings) => {
        if (!cancelled) setDefaultAuthor(settings.authorName);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [settingsRepository]);

  useEffect(() => {
    return bookRepository.observeBook(bookId, setBook, () => {});
  }, [bookRepository, bookId]);

  useEffect(() => {
    return chapterRepository.observeChapters(bookId, setChapters, () => {});
  }, [chapterRepository, bookId]);

  // self-healing of the denormalized counters: when the book opens,
  // in the background — the UI lives off the observe* subscriptions anyway
  useEffect(() => {
    bookRepository.reconcileCounters(bookId).catch(() => {});
  }, [bookRepository, bookId]);

  const statusColor = (status: ChapterStatus) =>
    status === 'final' ? colors.primary : status === 'refined' ? colors.accent : colors.statusDraft;

  const moveChapter = (index: number, direction: -1 | 1) => {
    if (chapters === null) return;
    const target = index + direction;
    if (target < 0 || target >= chapters.length) return;
    const ids = chapters.map((chapter) => chapter.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    chapterRepository.reorderChapters(bookId, ids).catch(() => {});
  };

  const createChapter = () => {
    const title = newTitle.trim();
    if (title === '') return;
    setCreating(false);
    setNewTitle('');
    chapterRepository.createChapter(bookId, { title }).catch(() => {});
  };

  const renderChapter = ({ item, index }: { item: ChapterSummary; index: number }) => (
    <Pressable
      accessibilityRole="button"
      testID={`book-chapter-${item.id}`}
      onPress={() => (reordering ? undefined : onOpenChapter(item, index + 1))}
      onLongPress={() => setReordering(true)}
      delayLongPress={350}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md + 2,
        paddingVertical: spacing.lg - 1,
        paddingHorizontal: spacing.xl,
        borderBottomWidth: 1,
        borderBottomColor: colors.hairlineLight,
      }}
    >
      <View style={{ width: 34 }}>
        <RomanNumeral value={index + 1} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: fonts.body, fontSize: typeScale.body + 1, color: colors.text }}
        >
          {item.title}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: statusColor(item.status),
            }}
          />
          <Text
            style={{ fontFamily: fonts.body, fontSize: typeScale.label, color: colors.textMuted }}
          >
            {`${statusLabel(item.status)} · ${tn('books.words', item.wordCount, { formatted: formatNumber(item.wordCount) })}`}
          </Text>
        </View>
      </View>
      {reordering ? (
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('books.moveUp', { title: item.title })}
            testID={`book-chapter-up-${item.id}`}
            disabled={index === 0}
            onPress={() => moveChapter(index, -1)}
            style={[
              styles.roundButton,
              { borderColor: colors.hairlineGold, opacity: index === 0 ? 0.35 : 1 },
            ]}
          >
            <Ionicons name="chevron-up" size={17} color={colors.textMutedStrong} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('books.moveDown', { title: item.title })}
            testID={`book-chapter-down-${item.id}`}
            disabled={chapters !== null && index === chapters.length - 1}
            onPress={() => moveChapter(index, 1)}
            style={[
              styles.roundButton,
              {
                borderColor: colors.hairlineGold,
                opacity: chapters !== null && index === chapters.length - 1 ? 0.35 : 1,
              },
            ]}
          >
            <Ionicons name="chevron-down" size={17} color={colors.textMutedStrong} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('books.dictate', { title: item.title })}
          testID={`book-chapter-mic-${item.id}`}
          onPress={() => onDictateChapter(item, index + 1)}
          style={[styles.roundButton, { borderColor: colors.primary }]}
        >
          <Ionicons name="mic-outline" size={17} color={colors.primary} />
        </Pressable>
      )}
    </Pressable>
  );

  const tabButton = (value: BookTab, label: string) => (
    <Pressable
      key={value}
      accessibilityRole="button"
      testID={`book-tab-${value}`}
      onPress={() => setTab(value)}
      style={{
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.lg,
        borderBottomWidth: 2,
        borderBottomColor: tab === value ? colors.primary : 'transparent',
      }}
    >
      <Text
        style={{
          fontFamily: tab === value ? fonts.bodySemiBold : fonts.body,
          fontSize: typeScale.body,
          color: tab === value ? colors.text : colors.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  const placeholder = (title: string, body: string) => (
    <View style={{ padding: spacing.xl }}>
      <Card style={{ alignItems: 'center', gap: spacing.sm }}>
        <Text
          style={{ fontFamily: fonts.display, fontSize: typeScale.heading, color: colors.text }}
        >
          {title}
        </Text>
        <OrnamentDivider style={{ alignSelf: 'stretch' }} />
        <Text
          style={{
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.bodySmall,
            color: colors.textMuted,
            textAlign: 'center',
          }}
        >
          {body}
        </Text>
      </Card>
    </View>
  );

  return (
    <Screen testID="book-screen">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('books.backToLibrary')}
          testID="book-back"
          onPress={onBack}
          style={styles.iconButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{ fontFamily: fonts.display, fontSize: typeScale.title + 1, color: colors.text }}
          >
            {book?.title ?? ''}
          </Text>
          {book !== null && (
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: typeScale.caption,
                color: colors.textMuted,
              }}
            >
              {`${tn('books.words', book.wordCount, { formatted: formatNumber(book.wordCount) })} · ${tn('books.chapters', book.chapterCount, { formatted: formatNumber(book.chapterCount) })}`}
            </Text>
          )}
        </View>
        {onOpenNotes !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('books.openNotes')}
            testID="book-open-notes"
            onPress={() => onOpenNotes(book?.title ?? '')}
            style={styles.iconButton}
          >
            <Ionicons name="book-outline" size={22} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: 'row',
          paddingHorizontal: spacing.xl,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        {tabButton('chapters', t('books.tabChapters'))}
        {tabButton('synopsis', t('books.tabSynopsis'))}
        {tabButton('export', t('books.tabExport'))}
      </View>

      {tab === 'synopsis' &&
        (book === null ? null : (
          <SynopsisTab
            key={book.id}
            book={book}
            bookRepository={bookRepository}
            chapterRepository={chapterRepository}
            outlineService={outlineService}
            outlineDrafts={outlineDrafts}
          />
        ))}
      {tab === 'export' &&
        (book === null ? null : (
          <ExportTab
            key={book.id}
            book={book}
            bookRepository={bookRepository}
            exportService={exportService}
            pendingSuggestions={pendingSuggestions}
            fileSink={exportFileSink}
            waitForSync={waitForSync}
            defaultAuthor={defaultAuthor}
          />
        ))}

      {tab === 'chapters' && (
        <FlatList
          data={chapters ?? []}
          ListHeaderComponent={
            book === null ? null : (
              <StylePicker
                book={book}
                onChange={(styleId) => {
                  bookRepository.updateBook(book.id, { styleProfileId: styleId }).catch(() => {});
                }}
              />
            )
          }
          keyExtractor={(chapter) => chapter.id}
          renderItem={renderChapter}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: listBottom }}
          ListFooterComponentStyle={{ flexGrow: 1 }}
          ListEmptyComponent={
            chapters === null
              ? null
              : placeholder(t('books.noChaptersTitle'), t('books.noChaptersBody'))
          }
          ListFooterComponent={
            <View style={{ flexGrow: 1, padding: spacing.xl, gap: spacing.md }}>
              <PrimaryButton
                label={t('books.newChapter')}
                testID="book-new-chapter"
                icon={<Ionicons name="add" size={20} color={colors.onPrimary} />}
                onPress={() => setCreating(true)}
              />
              {reordering ? (
                <PrimaryButton
                  label={t('books.reorderDone')}
                  testID="book-reorder-done"
                  onPress={() => setReordering(false)}
                />
              ) : (
                <Text
                  style={{
                    textAlign: 'center',
                    fontFamily: fonts.bodyItalic,
                    fontSize: typeScale.caption,
                    color: colors.textMuted,
                  }}
                >
                  {t('books.reorderHint')}
                </Text>
              )}
              <ArchesFill />
            </View>
          }
        />
      )}

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
              {t('books.newChapter')}
            </Text>
            <OrnamentDivider />
            <TextInput
              testID="book-new-chapter-title"
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder={t('books.chapterTitlePlaceholder')}
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
              label={t('books.createChapter')}
              testID="book-new-chapter-create"
              disabled={newTitle.trim() === ''}
              onPress={createChapter}
            />
            <Pressable
              accessibilityRole="button"
              testID="book-new-chapter-cancel"
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
