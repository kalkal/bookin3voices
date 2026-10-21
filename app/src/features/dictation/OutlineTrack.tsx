/**
 * The chapter's key beats, the ONE panel shown while dictating and in the
 * chapter editor (Editor and Review): label "Traccia · Capitolo <roman
 * numeral>" and the outline beats, each with the gold diamond of the visual
 * signature. Tapping a beat marks it covered/to-do: a purely visual mark
 * persisted in `outline.beatsDone` on the chapter, no automation.
 *
 * Collapsible but never lost: the open/closed choice is remembered PER
 * CHAPTER, and closed still shows how many beats are covered and the next one
 * to cover, with the chevron to open it again. A chapter snapshot that comes
 * back unreadable for a moment (null) keeps the beats already on screen.
 * Chapter without an outline (or with empty beats): the panel does not exist.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components';
import { t } from '../../i18n';
import { useTheme } from '../../theme';
import type {
  Chapter,
  ChapterOutline,
  ChapterPatch,
  ChapterRef,
  KeyValueStorage,
  Unsubscribe,
} from '../chapters';

/**
 * The minimum the track needs: read the chapter (for the outline) and
 * write its patch. ChapterRepository satisfies it structurally, so the
 * screen does not depend on the full CRUD (Repository).
 */
export interface OutlineTrackRepository {
  observeChapter(
    ref: ChapterRef,
    onChange: (chapter: Chapter | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
  updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void>;
}

export interface OutlineTrackProps {
  chapter: ChapterRef;
  repository: OutlineTrackRepository;
  /** Right part of the label, e.g. "Capitolo VII" → "Traccia · Capitolo VII". */
  chapterLabel?: string;
  /** Storage for the remembered open/closed state; defaults to AsyncStorage. */
  storage?: KeyValueStorage;
}

/**
 * Where the open/closed choice of ONE chapter is remembered. (It used to be a
 * single app-wide key, 'bookvoice/dettatura/traccia-chiusa': closing it once
 * hid the beats of every chapter. That key is no longer read.)
 */
export const outlineTrackCollapsedKey = (chapter: ChapterRef) =>
  `bookvoice/outline-track/${chapter.bookId}/${chapter.chapterId}/collapsed`;

export function OutlineTrack({
  chapter,
  repository,
  chapterLabel,
  storage = AsyncStorage,
}: OutlineTrackProps) {
  const { colors, fonts, spacing, typeScale, letterSpacing } = useTheme();
  const [outline, setOutline] = useState<ChapterOutline | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    return repository.observeChapter(chapter, (doc) => {
      // null = no readable document right now: keep what is on screen
      if (doc !== null) setOutline(doc.outline);
    });
    // the chapter coordinates are fixed for the screen's lifetime (key in App)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    storage
      .getItem(outlineTrackCollapsedKey(chapter))
      .then((value) => {
        if (!cancelled && value === '1') setCollapsed(true);
      })
      .catch(() => {}); // unreadable storage: start open, no big deal
    return () => {
      cancelled = true;
    };
    // the storage is fixed for the panel's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (outline === null || outline.beats.length === 0) return null;

  const doneCount = outline.beats.filter((_, index) => outline.beatsDone.includes(index)).length;
  const nextBeat = outline.beats.find((_, index) => !outline.beatsDone.includes(index));

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    storage.setItem(outlineTrackCollapsedKey(chapter), next ? '1' : '0').catch(() => {});
  };

  const toggleBeat = (index: number) => {
    const done = outline.beatsDone.includes(index);
    const beatsDone = done
      ? outline.beatsDone.filter((beat) => beat !== index)
      : [...outline.beatsDone, index];
    const nextOutline: ChapterOutline = { ...outline, beatsDone };
    // optimistic: the screen updates right away, the observe confirms
    setOutline(nextOutline);
    repository.updateChapter(chapter, { outline: nextOutline }).catch(() => {});
  };

  return (
    <Card
      testID="outline-track"
      style={{
        marginHorizontal: spacing.xl,
        marginBottom: spacing.sm,
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.lg,
        gap: spacing.sm,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={collapsed ? t('dictation.outline.open') : t('dictation.outline.close')}
        testID="outline-track-toggle"
        onPress={toggleCollapsed}
        style={[styles.headerRow, { gap: spacing.md }]}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: colors.primary,
            fontFamily: fonts.body,
            fontSize: typeScale.label,
            letterSpacing: letterSpacing.label,
            textTransform: 'uppercase',
          }}
        >
          {chapterLabel === undefined || chapterLabel === ''
            ? t('dictation.outline.label')
            : t('dictation.outline.labelWith', { chapter: chapterLabel })}
        </Text>
        <Text
          testID="outline-track-count"
          style={{
            color: colors.textMutedStrong,
            fontFamily: fonts.body,
            fontSize: typeScale.label,
          }}
        >
          {t('dictation.outline.progress', { done: doneCount, total: outline.beats.length })}
        </Text>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={18}
          color={colors.textMutedStrong}
        />
      </Pressable>

      {collapsed
        ? nextBeat !== undefined && (
            <Text
              testID="outline-next-beat"
              numberOfLines={2}
              style={{
                color: colors.text,
                fontFamily: fonts.body,
                fontSize: typeScale.bodySmall,
              }}
            >
              {t('dictation.outline.next', { beat: nextBeat })}
            </Text>
          )
        : outline.beats.map((beat, index) => {
            const done = outline.beatsDone.includes(index);
            return (
              <Pressable
                key={`${index}-${beat}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={beat}
                testID={`outline-beat-${index}`}
                onPress={() => toggleBeat(index)}
                style={[styles.beatRow, { gap: spacing.sm }]}
              >
                <View
                  style={[
                    styles.diamond,
                    { backgroundColor: done ? colors.hairlineGold : colors.accent },
                  ]}
                />
                <Text
                  style={{
                    flex: 1,
                    // covered beats step back but stay AA on the card in both themes
                    color: done ? colors.textMutedStrong : colors.text,
                    textDecorationLine: done ? 'line-through' : 'none',
                    fontFamily: fonts.body,
                    fontSize: typeScale.bodySmall,
                  }}
                >
                  {beat}
                </Text>
              </Pressable>
            );
          })}
    </Card>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  beatRow: { flexDirection: 'row', alignItems: 'center' },
  diamond: { width: 6, height: 6, transform: [{ rotate: '45deg' }] },
});
