/**
 * The panel a refine starts from: WHAT is refined (the scope: whole chapter,
 * selection or paragraph) and WHICH kinds the AI checks (style, grammar,
 * pacing, period details), all on by default. «Avvia» sends the request;
 * with every kind off there is nothing to check, so it is disabled.
 * Sits in the toolbar above the keyboard: never over the text.
 *
 * The toggles are icons only. The first time the panel ever opens their names
 * show under them for a few seconds and fade (remembered on the device); a long
 * press shows one name any time. An «off» kind has a dashed border, never
 * colour alone; every toggle has an accessible name and state.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip } from '../../components';
import { t } from '../../i18n';
import { useTheme } from '../../theme';
import type { KeyValueStorage } from '../chapters';
import { KIND_LABELS, SUGGESTION_KINDS, type SuggestionKind } from './types';

/** Device flag: the kind names were shown once. */
export const KINDS_SEEN_KEY = 'bookvoice/review/refineKindsSeen';
/** How long the names stay before fading. */
export const KIND_NAMES_MS = 3500;
const FADE_MS = 600;

const KIND_ICONS: Record<SuggestionKind, keyof typeof Ionicons.glyphMap> = {
  style: 'brush-outline',
  grammar: 'checkmark-done-outline',
  pacing: 'pulse-outline',
  history: 'hourglass-outline',
};

export type RefineScope =
  | { kind: 'chapter' }
  | { kind: 'selection'; range: { from: number; to: number } }
  | { kind: 'paragraph'; range: { from: number; to: number } }
  | { kind: 'title' };

const SCOPE_KEYS: Record<RefineScope['kind'], string> = {
  chapter: 'review.panel.scope.chapter',
  selection: 'review.panel.scope.selection',
  paragraph: 'review.panel.scope.paragraph',
  title: 'review.panel.scope.title',
};

export function RefinePanel({
  scope,
  scopes = [scope],
  onScope,
  kindsOn,
  onToggle,
  onStart,
  onCancel,
  storage = AsyncStorage,
}: {
  scope: RefineScope['kind'];
  /** The scopes on offer (the current one included); one chip each. */
  scopes?: readonly RefineScope['kind'][];
  onScope?: (scope: RefineScope['kind']) => void;
  kindsOn: readonly SuggestionKind[];
  onToggle: (kind: SuggestionKind) => void;
  onStart: () => void;
  onCancel: () => void;
  /** Where «names already shown» is remembered; default AsyncStorage. */
  storage?: KeyValueStorage;
}) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  // which names are visible: all of them (first time) or the long-pressed one
  const [named, setNamed] = useState<readonly SuggestionKind[]>([]);
  const [opacity] = useState(() => new Animated.Value(1));
  // one set for the panel's whole life: the unmount cleanup clears every timer
  const [timers] = useState(() => new Set<ReturnType<typeof setTimeout>>());
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };
  const showNames = (kinds: readonly SuggestionKind[]) => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    opacity.setValue(1);
    setNamed(kinds);
    later(KIND_NAMES_MS, () =>
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(),
    );
    later(KIND_NAMES_MS + FADE_MS, () => setNamed([]));
  };
  useEffect(() => {
    let cancelled = false;
    storage
      .getItem(KINDS_SEEN_KEY)
      .then((seen) => {
        if (cancelled || seen !== null) return;
        showNames(SUGGESTION_KINDS);
        storage.setItem(KINDS_SEEN_KEY, '1').catch(() => {});
      })
      .catch(() => {
        // unreadable: no first-time names, long press still works
      });
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
    // once per opening of the panel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View testID="refine-panel" style={{ gap: spacing.sm }}>
      <Text
        testID="refine-scope"
        style={{
          color: colors.textMutedStrong,
          fontFamily: fonts.body,
          fontSize: typeScale.caption,
        }}
      >
        {t('review.panel.scope', { scope: t(SCOPE_KEYS[scope]) })}
      </Text>
      {scopes.length > 1 ? (
        <View style={[styles.row, { gap: spacing.sm }]} accessibilityRole="radiogroup">
          {scopes.map((choice) => (
            <Pressable
              key={choice}
              testID={`refine-scope-${choice}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: choice === scope }}
              onPress={() => onScope?.(choice)}
              // a chip is about 28 px tall: the slop brings the touch target to 44
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={[
                styles.scopeChip,
                {
                  borderColor: choice === scope ? colors.primary : colors.hairline,
                  borderStyle: choice === scope ? 'solid' : 'dashed',
                  backgroundColor: choice === scope ? colors.selectedTint : undefined,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                },
              ]}
            >
              <Text
                style={{
                  color: colors.text,
                  fontFamily: fonts.body,
                  fontSize: typeScale.caption,
                }}
              >
                {t(SCOPE_KEYS[choice])}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {scope === 'title' ? null : (
        <View style={[styles.row, { gap: spacing.sm }]}>
          {SUGGESTION_KINDS.map((kind) => {
            const on = kindsOn.includes(kind);
            return (
              <View key={kind} style={styles.toggleColumn}>
                <Pressable
                  testID={`refine-kind-${kind}`}
                  accessibilityRole="switch"
                  accessibilityLabel={KIND_LABELS[kind]}
                  accessibilityState={{ checked: on }}
                  accessibilityHint={t('review.panel.kindHint')}
                  onPress={() => onToggle(kind)}
                  onLongPress={() => showNames([kind])}
                  hitSlop={6}
                  style={[
                    styles.toggle,
                    {
                      borderColor: on ? colors.primary : colors.textMuted,
                      borderStyle: on ? 'solid' : 'dashed',
                      backgroundColor: on ? colors.selectedTint : undefined,
                    },
                  ]}
                >
                  <Ionicons
                    testID={`refine-kind-icon-${kind}`}
                    name={KIND_ICONS[kind]}
                    size={20}
                    color={on ? colors.primary : colors.textMuted}
                  />
                </Pressable>
                {named.includes(kind) ? (
                  <Animated.Text
                    testID={`refine-kind-name-${kind}`}
                    style={{
                      opacity,
                      color: colors.textMutedStrong,
                      fontFamily: fonts.body,
                      fontSize: typeScale.caption,
                    }}
                  >
                    {KIND_LABELS[kind]}
                  </Animated.Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Chip
          label={t('review.panel.start')}
          tone="green"
          testID="refine-start"
          // with every kind off there is nothing to check (kinds do not apply to a title)
          disabled={scope !== 'title' && kindsOn.length === 0}
          onPress={onStart}
        />
        <Chip label={t('review.panel.cancel')} testID="refine-cancel" onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  toggleColumn: { alignItems: 'center', minWidth: 56 },
  scopeChip: { borderWidth: 1, borderRadius: 999 },
  toggle: {
    borderWidth: 1.5,
    borderRadius: 999,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
