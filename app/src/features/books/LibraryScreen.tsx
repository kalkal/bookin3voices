/**
 * Schermata Libreria: frontespizio bookin3voice
 * con ornamento, card "Obiettivo di oggi" (dailyGoalWords dalle impostazioni
 * della schermata Impostazioni + parole aggiunte oggi), elenco dei libri come volumi rilegati con
 * progresso dai contatori denormalizzati (si leggono SOLO i documenti
 * libro) e FAB "+ Nuovo libro". L'ingranaggio in alto apre le Impostazioni.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, OrnamentDivider, PrimaryButton } from '../../components';
import { formatNumber } from '../../lib/text';
import { useTheme } from '../../theme';
import type { SettingsRepository } from '../settings';
import type { DailyProgressRepository } from './dailyProgress';
import type { Book, BookRepository } from './types';

/**
 * Traguardo indicativo di un libro (romanzo tipico), usato SOLO per la barra
 * di avanzamento della card: un campo targetWords per libro è una scelta di
 * prodotto (per ora non è nello schema).
 */
export const BOOK_TARGET_WORDS = 60_000;

export interface LibraryScreenProps {
  bookRepository: BookRepository;
  settingsRepository: SettingsRepository;
  dailyProgressRepository: DailyProgressRepository;
  onOpenBook: (book: Book) => void;
  onOpenSettings: () => void;
  /** Apre il Diario dei progressi (versione estesa della card obiettivo). */
  onOpenProgress: () => void;
}

/** Mese di inizio in italiano per la riga meta ("Romanzo · iniziato a giugno"). */
function startedLabel(createdAtMillis: number): string {
  try {
    const month = new Intl.DateTimeFormat('it-IT', { month: 'long' }).format(
      new Date(createdAtMillis),
    );
    return `iniziato a ${month}`;
  } catch {
    return 'in corso';
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

  // obiettivo del giorno: impostazioni + contatore locale delle parole
  useEffect(() => {
    let cancelled = false;
    settingsRepository
      .load()
      .then((settings) => {
        if (cancelled) return;
        setDailyGoal(settings.dailyGoalWords);
        // riconcilia la serie all'apertura della Libreria (qui non si mostra):
        // tiene fresco il contatore non potato così non riparte aprendo i Progressi
        dailyProgressRepository.getStreak(settings.dailyGoalWords).catch(() => {});
      })
      .catch(() => {
        // senza impostazioni leggibili la card obiettivo resta nascosta
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
              {`${item.genre === '' ? 'Libro' : item.genre} · ${startedLabel(item.createdAt)}`}
            </Text>
            <Text
              style={{ fontFamily: fonts.body, fontSize: typeScale.bodySmall, color: colors.text }}
            >
              {`${formatNumber(item.chapterCount)} ${item.chapterCount === 1 ? 'capitolo' : 'capitoli'} · ${formatNumber(item.wordCount)} parole`}
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
            accessibilityLabel="Impostazioni"
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
            accessibilityLabel="Apri il diario dei progressi"
            onPress={onOpenProgress}
          >
            <Card style={{ marginTop: spacing.xl, gap: spacing.sm + 2 }} testID="library-goal">
              <View style={styles.goalHeader}>
                <Text style={sectionLabelStyle}>Obiettivo di oggi</Text>
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
                  {`${formatNumber(todayWords)} / ${formatNumber(dailyGoal)} parole`}
                </Text>
              </View>
            </Card>
          </Pressable>
        )}

        <View style={[styles.sectionRow, { marginTop: spacing.xxl, marginBottom: spacing.sm }]}>
          <Text style={sectionLabelStyle}>I tuoi libri</Text>
          {books !== null && books.length > 0 && (
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: typeScale.caption,
                color: colors.textMuted,
              }}
            >
              {`${inProgress} in corso`}
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
          La libreria non si aggiorna: si riproverà da solo appena torna la rete.
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
                Nessun libro, per ora
              </Text>
              <Text
                style={{
                  fontFamily: fonts.bodyItalic,
                  fontSize: typeScale.bodySmall,
                  color: colors.textMuted,
                  textAlign: 'center',
                }}
              >
                Tocca il + qui sotto per rilegare il primo volume.
              </Text>
            </Card>
          )
        }
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Nuovo libro"
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
              Nuovo libro
            </Text>
            <OrnamentDivider />
            <TextInput
              testID="library-new-book-title"
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Titolo del libro"
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
              label="Crea libro"
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
