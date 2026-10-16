/**
 * Chapter track in Dictation:
 * a collapsible panel above the text with the label
 * "Traccia · Capitolo <roman numeral>" and the outline beats, each with the
 * gold diamond of the visual signature. Tapping a beat marks it covered/to-do:
 * a purely visual mark persisted in `outline.beatsDone` on the chapter, no
 * automation. The open/closed state is remembered across sessions; when
 * closed, only the header row remains. Chapter without an outline (or with
 * empty beats): the panel does not exist.
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

/** Single preference (not per chapter): the last open/closed choice applies everywhere. */
export const OUTLINE_TRACK_COLLAPSED_KEY = 'bookvoice/dettatura/traccia-chiusa';

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
    return repository.observeChapter(chapter, (doc) => setOutline(doc?.outline ?? null));
    // the chapter coordinates are fixed for the screen's lifetime (key in App)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    storage
      .getItem(OUTLINE_TRACK_COLLAPSED_KEY)
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

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    storage.setItem(OUTLINE_TRACK_COLLAPSED_KEY, next ? '1' : '0').catch(() => {});
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
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={18}
          color={colors.textMuted}
        />
      </Pressable>

      {collapsed
        ? null
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
                    color: done ? colors.textMuted : colors.text,
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
