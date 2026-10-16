/**
 * Schermata Taccuino (feature Taccuino, brief): il contenitore di idee/pensieri
 * di un libro. Intestazione con eyebrow = titolo del libro e "Taccuino", riga
 * di chip per filtrare per tag (Tutte + categorie), lista di schede
 * (data · tag · testo) cronologica (più recenti in cima), FAB "Detta un'idea"
 * che apre la cattura vocale, empty state quando non c'è nulla.
 *
 * Regole di dominio: la UI dipende SOLO da NoteRepository via props,
 * mai dall'SDK Firebase; usa solo i token del tema e i componenti in
 * components/. Il motore di dettatura è iniettabile (Fake nei test).
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Chip, OrnamentDivider, PrimaryButton } from '../../components';
import { ExpoDictationEngine } from '../dictation';
import type { DictationEngine } from '../dictation';
import { t, uiLocale } from '../../i18n';
import { useTheme } from '../../theme';
import { NoteCaptureModal } from './NoteCaptureModal';
import { filterNotesByTag, type NoteFilter } from './noteFilter';
import { NOTE_TAGS } from './types';
import type { Note, NoteRepository, NoteTag } from './types';

export interface NotesScreenProps {
  bookId: string;
  /** Titolo del libro, mostrato come eyebrow sopra "Taccuino". */
  bookTitle: string;
  noteRepository: NoteRepository;
  /** Motore STT; default ExpoDictationEngine. I test passano il Fake. */
  engine?: DictationEngine;
  lang?: string;
  onBack: () => void;
}

const tagLabel = (tag: NoteTag): string => t(`notes.tag.${tag}`);

/** Data breve nella lingua dell'interfaccia ("17 set 2026"); ripiego spoglio se Intl manca. */
function formatDate(millis: number): string {
  try {
    return new Intl.DateTimeFormat(uiLocale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(millis));
  } catch {
    return new Date(millis).toISOString().slice(0, 10);
  }
}

export function NotesScreen({
  bookId,
  bookTitle,
  noteRepository,
  engine,
  lang,
  onBack,
}: NotesScreenProps) {
  const { colors, fonts, spacing, radius, typeScale, letterSpacing } = useTheme();

  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<NoteFilter>(null);
  const [capturing, setCapturing] = useState(false);
  // nota in modifica (null = nuova idea); pilota titolo/valori del pannello
  const [editing, setEditing] = useState<Note | null>(null);
  // nota su cui è aperto il menu azioni (modifica/elimina), null = chiuso
  const [actionsFor, setActionsFor] = useState<Note | null>(null);
  // secondo passo del menu: conferma leggera prima di eliminare
  const [confirmDelete, setConfirmDelete] = useState(false);
  // rimonta il pannello di cattura a ogni apertura → stato pulito senza effetti
  const [captureKey, setCaptureKey] = useState(0);

  // il motore nativo si crea una sola volta, e solo se non è stato iniettato
  const resolvedEngine = useMemo<DictationEngine>(
    () => engine ?? new ExpoDictationEngine(),
    // fisso per la vita della schermata
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => resolvedEngine.dispose(), [resolvedEngine]);

  useEffect(() => {
    return noteRepository.observeNotes(
      bookId,
      (next) => {
        setError(false);
        setNotes(next);
      },
      // un listener in errore non deve lasciare la schermata muta per sempre:
      // si mostra un avviso (coerente con LibraryScreen)
      () => setError(true),
    );
  }, [noteRepository, bookId]);

  const visibleNotes = useMemo(
    () => (notes === null ? [] : filterNotesByTag(notes, filter)),
    [notes, filter],
  );

  const openCapture = (note: Note | null) => {
    setEditing(note);
    setCaptureKey((k) => k + 1);
    setCapturing(true);
  };

  const saveNote = (text: string, tag: NoteTag | null) => {
    setCapturing(false);
    if (editing !== null) {
      noteRepository.updateNote({ bookId, noteId: editing.id }, { text, tag }).catch(() => {});
    } else {
      noteRepository.createNote(bookId, { text, tag }).catch(() => {});
    }
    setEditing(null);
  };

  const deleteNote = (note: Note) => {
    setActionsFor(null);
    setConfirmDelete(false);
    noteRepository.deleteNote({ bookId, noteId: note.id }).catch(() => {});
  };

  const renderNote = ({ item }: { item: Note }) => (
    <Pressable
      testID={`note-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={t('notes.noteLabel', { date: formatDate(item.createdAt) })}
      onLongPress={() => {
        setConfirmDelete(false);
        setActionsFor(item);
      }}
      delayLongPress={350}
    >
      <Card style={{ marginBottom: spacing.md, gap: spacing.sm }}>
        <View style={[styles.metaRow, { gap: spacing.sm }]}>
          <Text
            style={{ fontFamily: fonts.body, fontSize: typeScale.label, color: colors.textMuted }}
          >
            {formatDate(item.createdAt)}
          </Text>
          {item.tag !== null ? <Chip label={tagLabel(item.tag)} uppercase tone="gold" /> : null}
        </View>
        <Text style={{ fontFamily: fonts.body, fontSize: typeScale.body, color: colors.text }}>
          {item.text}
        </Text>
      </Card>
    </Pressable>
  );

  const filterChip = (value: NoteFilter, label: string) => (
    <Chip
      key={value ?? 'all'}
      label={label}
      selected={filter === value}
      tone="green"
      onPress={() => setFilter(value)}
      testID={`notes-filter-${value ?? 'all'}`}
    />
  );

  return (
    <SafeAreaView
      testID="notes-screen"
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { gap: spacing.md, paddingHorizontal: spacing.lg }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('notes.back')}
          testID="notes-back"
          onPress={onBack}
          style={styles.iconButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: fonts.body,
              fontSize: typeScale.label,
              letterSpacing: letterSpacing.label,
              color: colors.primary,
              textTransform: 'uppercase',
            }}
          >
            {bookTitle}
          </Text>
          <Text
            style={{ fontFamily: fonts.display, fontSize: typeScale.title + 1, color: colors.text }}
          >
            {t('notes.title')}
          </Text>
        </View>
      </View>

      <View style={{ borderBottomWidth: 1, borderBottomColor: colors.hairline }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: spacing.sm,
            paddingHorizontal: spacing.xl,
            paddingVertical: spacing.md,
          }}
        >
          {filterChip(null, t('notes.filterAll'))}
          {NOTE_TAGS.map((tag) => filterChip(tag, tagLabel(tag)))}
        </ScrollView>
      </View>

      {error && (
        <Text
          testID="notes-error"
          style={{
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.md,
            color: colors.textMutedStrong,
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
          }}
        >
          {t('notes.error')}
        </Text>
      )}

      <FlatList
        data={visibleNotes}
        keyExtractor={(note) => note.id}
        renderItem={renderNote}
        contentContainerStyle={{
          padding: spacing.xl,
          paddingBottom: spacing.xxxl * 3,
          flexGrow: 1,
        }}
        ListEmptyComponent={
          notes === null ? null : (
            <View testID="notes-empty" style={{ paddingTop: spacing.xxxl, alignItems: 'center' }}>
              <Card style={{ alignItems: 'center', gap: spacing.sm, maxWidth: 340 }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: typeScale.heading,
                    color: colors.text,
                    textAlign: 'center',
                  }}
                >
                  {filter === null ? t('notes.empty.title') : t('notes.empty.titleFiltered')}
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
                  {filter === null ? t('notes.empty.body') : t('notes.empty.bodyFiltered')}
                </Text>
              </Card>
            </View>
          )
        }
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('notes.fab')}
        testID="notes-fab"
        onPress={() => openCapture(null)}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: colors.primary,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.xl,
            gap: spacing.sm,
            shadowColor: colors.shadow,
            opacity: pressed ? 0.9 : 1,
            right: spacing.xl,
            bottom: spacing.xl,
          },
        ]}
      >
        <Ionicons name="mic" size={20} color={colors.onPrimary} />
        <Text
          style={{
            color: colors.onPrimary,
            fontFamily: fonts.body,
            fontSize: typeScale.body,
            letterSpacing: letterSpacing.button,
          }}
        >
          {t('notes.fab')}
        </Text>
      </Pressable>

      <NoteCaptureModal
        key={captureKey}
        visible={capturing}
        engine={resolvedEngine}
        lang={lang}
        onCancel={() => {
          setCapturing(false);
          setEditing(null);
        }}
        onSave={saveNote}
        initialText={editing?.text ?? ''}
        initialTag={editing?.tag ?? null}
        title={editing !== null ? t('notes.capture.editTitle') : t('notes.capture.newTitle')}
        saveLabel={editing !== null ? t('notes.capture.saveEdit') : t('notes.capture.save')}
      />

      <Modal
        visible={actionsFor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActionsFor(null)}
      >
        <View style={[styles.backdrop, { backgroundColor: colors.shadow }]}>
          <Card testID="note-actions" style={{ width: '100%', maxWidth: 340, gap: spacing.md }}>
            {!confirmDelete ? (
              <>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: typeScale.title,
                    color: colors.text,
                    textAlign: 'center',
                  }}
                >
                  {t('notes.actions.title')}
                </Text>
                <OrnamentDivider />
                <PrimaryButton
                  label={t('notes.actions.edit')}
                  testID="note-actions-edit"
                  onPress={() => {
                    const note = actionsFor;
                    setActionsFor(null);
                    if (note !== null) openCapture(note);
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  testID="note-actions-delete"
                  onPress={() => setConfirmDelete(true)}
                  style={{ alignSelf: 'center', padding: spacing.xs }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.body,
                      fontSize: typeScale.body,
                      color: colors.coverLeather,
                    }}
                  >
                    {t('notes.actions.delete')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  testID="note-actions-cancel"
                  onPress={() => setActionsFor(null)}
                  style={{ alignSelf: 'center', padding: spacing.xs }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.bodyItalic,
                      fontSize: typeScale.bodySmall,
                      color: colors.textMutedStrong,
                    }}
                  >
                    {t('notes.actions.cancel')}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text
                  style={{
                    fontFamily: fonts.body,
                    fontSize: typeScale.body,
                    color: colors.text,
                    textAlign: 'center',
                  }}
                >
                  {t('notes.actions.confirm')}
                </Text>
                <PrimaryButton
                  label={t('notes.actions.delete')}
                  testID="note-actions-delete-confirm"
                  onPress={() => {
                    if (actionsFor !== null) deleteNote(actionsFor);
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  testID="note-actions-delete-cancel"
                  onPress={() => setConfirmDelete(false)}
                  style={{ alignSelf: 'center', padding: spacing.xs }}
                >
                  <Text
                    style={{
                      fontFamily: fonts.bodyItalic,
                      fontSize: typeScale.bodySmall,
                      color: colors.textMutedStrong,
                    }}
                  >
                    {t('notes.actions.cancel')}
                  </Text>
                </Pressable>
              </>
            )}
          </Card>
        </View>
      </Modal>
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  fab: {
    position: 'absolute',
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
});
