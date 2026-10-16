/**
 * Schermata Libro: intestazione con titolo e
 * contatori denormalizzati, tre tab. *Capitoli*: lista ordinata con numerale
 * romano, stato a colore (bozza/rifinito/finale), conteggio parole, mic sulla
 * riga (→ Dettatura) e tap sulla riga (→ Editor); riordino con press lungo
 * (frecce su/giù — il drag&drop vero arriverà con una gesture library);
 * "+ Nuovo capitolo" in coda. *Sinossi*: sinossi + scaletta generata con
 * anteprima corkboard (features/outline). *Export*: metadati KDP,
 * formato e generazione con share sheet (features/export).
 * All'apertura parte la riconciliazione self-healing dei contatori.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, OrnamentDivider, PrimaryButton, RomanNumeral } from '../../components';
import { formatNumber } from '../../lib/text';
import { useTheme } from '../../theme';
import type { ChapterRepository, ChapterStatus, ChapterSummary } from '../chapters';
import { ExportTab } from '../export';
import type { BookExportService, ExportFileSink, PendingSuggestionsRepository } from '../export';
import { SynopsisTab } from '../outline';
import type { OutlineService } from '../outline';
import { StylePicker } from './StylePicker';
import type { Book, BookRepository } from './types';

export interface BookScreenProps {
  bookId: string;
  bookRepository: BookRepository;
  chapterRepository: ChapterRepository;
  exportService: BookExportService;
  pendingSuggestions: PendingSuggestionsRepository;
  exportFileSink: ExportFileSink;
  outlineService: OutlineService;
  onBack: () => void;
  /** Tap sulla riga: apre l'Editor capitolo. `position` è 1-based. */
  onOpenChapter: (chapter: ChapterSummary, position: number) => void;
  /** Mic sulla riga: apre la Dettatura su quel capitolo. `position` è 1-based. */
  onDictateChapter: (chapter: ChapterSummary, position: number) => void;
  /** Azione nell'header: apre il Taccuino del libro. Riceve il titolo. */
  onOpenNotes?: (bookTitle: string) => void;
}

type BookTab = 'chapters' | 'synopsis' | 'export';

const STATUS_LABELS: Record<ChapterStatus, string> = {
  draft: 'Bozza',
  refined: 'Rifinito',
  final: 'Finale',
};

export function BookScreen({
  bookId,
  bookRepository,
  chapterRepository,
  exportService,
  pendingSuggestions,
  exportFileSink,
  outlineService,
  onBack,
  onOpenChapter,
  onDictateChapter,
  onOpenNotes,
}: BookScreenProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[] | null>(null);
  const [tab, setTab] = useState<BookTab>('chapters');
  const [reordering, setReordering] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    return bookRepository.observeBook(bookId, setBook, () => {});
  }, [bookRepository, bookId]);

  useEffect(() => {
    return chapterRepository.observeChapters(bookId, setChapters, () => {});
  }, [chapterRepository, bookId]);

  // self-healing dei contatori denormalizzati: all'apertura del libro,
  // in background — la UI vive comunque degli observe*
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
            {`${STATUS_LABELS[item.status]} · ${formatNumber(item.wordCount)} parole`}
          </Text>
        </View>
      </View>
      {reordering ? (
        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sposta su ${item.title}`}
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
            accessibilityLabel={`Sposta giù ${item.title}`}
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
          accessibilityLabel={`Detta ${item.title}`}
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
    <SafeAreaView
      testID="book-screen"
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
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
          accessibilityLabel="Torna alla Libreria"
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
              {`${formatNumber(book.wordCount)} parole · ${formatNumber(book.chapterCount)} ${book.chapterCount === 1 ? 'capitolo' : 'capitoli'}`}
            </Text>
          )}
        </View>
        {onOpenNotes !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Apri il Taccuino"
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
        {tabButton('chapters', 'Capitoli')}
        {tabButton('synopsis', 'Sinossi')}
        {tabButton('export', 'Export')}
      </View>

      {tab === 'synopsis' &&
        (book === null ? null : (
          <SynopsisTab
            key={book.id}
            book={book}
            bookRepository={bookRepository}
            chapterRepository={chapterRepository}
            outlineService={outlineService}
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
          ListEmptyComponent={
            chapters === null
              ? null
              : placeholder('Ancora nessun capitolo', 'Crea il primo capitolo e inizia a dettare.')
          }
          ListFooterComponent={
            <View style={{ padding: spacing.xl, gap: spacing.md }}>
              <PrimaryButton
                label="Nuovo capitolo"
                testID="book-new-chapter"
                icon={<Ionicons name="add" size={20} color={colors.onPrimary} />}
                onPress={() => setCreating(true)}
              />
              {reordering ? (
                <PrimaryButton
                  label="Fine riordino"
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
                  Tieni premuto un capitolo per riordinare
                </Text>
              )}
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
              Nuovo capitolo
            </Text>
            <OrnamentDivider />
            <TextInput
              testID="book-new-chapter-title"
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Titolo del capitolo"
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
              label="Crea capitolo"
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
                Annulla
              </Text>
            </Pressable>
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
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
