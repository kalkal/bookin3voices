/**
 * The screen the app opens on while it loads: black, with the gold mark in the
 * middle and thin gold rays turning slowly behind it, like light through a
 * rose window. No spinner: the rays are enough. If the opening takes more than
 * 3 s a discreet line appears under the mark; if it fails, a clear message and
 * a Retry button replace the rays, so the app is never stuck here.
 *
 * It renders before the theme and the fonts are ready, so it takes its colours
 * straight from the black-and-gold palette and uses the system serif. The rays
 * stand still when the system asks to reduce motion. The native splash stays
 * static; the movement lives only here.
 */
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t } from '../../i18n';
import { candlelightPalette as palette, serifFallback } from '../../theme/tokens';

/** After this long the app says what it is doing. */
export const SLOW_START_MS = 3000;

const MARK = require('../../../assets/brand/mark.png');
const RAYS = require('../../../assets/brand/rays.png');

const RAYS_SIZE = 460;
const MARK_SIZE = 150;
const TURN_MS = 120_000;
const PULSE_MS = 6000;
const RAYS_LOW = 0.1;
const RAYS_HIGH = 0.24;

export function StartupScreen({ error, onRetry }: { error: boolean; onRetry: () => void }) {
  const [slow, setSlow] = useState(false);
  const [turn] = useState(() => new Animated.Value(0));
  // starts at the low end: a loop restarts from the value it was created with, so the pulse stays smooth
  const [glow] = useState(() => new Animated.Value(RAYS_LOW));

  useEffect(() => {
    if (error) return;
    const timer = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => clearTimeout(timer);
  }, [error]);

  // slow turn and slow pulse, unless the system asks for less motion
  useEffect(() => {
    if (error) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled || reduce) return;
        const useNativeDriver = Platform.OS !== 'web';
        const turning = Animated.loop(
          Animated.timing(turn, {
            toValue: 1,
            duration: TURN_MS,
            easing: Easing.linear,
            useNativeDriver,
          }),
        );
        const pulsing = Animated.loop(
          Animated.sequence([
            Animated.timing(glow, { toValue: RAYS_HIGH, duration: PULSE_MS, useNativeDriver }),
            Animated.timing(glow, { toValue: RAYS_LOW, duration: PULSE_MS, useNativeDriver }),
          ]),
        );
        turning.start();
        pulsing.start();
        stop = () => {
          turning.stop();
          pulsing.stop();
        };
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [error, turn, glow]);

  // iOS has no live regions: say the message out loud there (a no-op elsewhere is harmless)
  const spoken = error ? t('startup.error') : slow ? t('startup.opening') : null;
  useEffect(() => {
    if (spoken !== null) AccessibilityInfo.announceForAccessibility(spoken);
  }, [spoken]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View testID={error ? 'auth-error' : 'startup-screen'} style={styles.screen}>
      {!error && (
        <Animated.Image
          testID="startup-rays"
          source={RAYS}
          style={[styles.rays, { opacity: glow, transform: [{ rotate }] }]}
        />
      )}
      <Image testID="startup-mark" source={MARK} style={styles.mark} />
      {/* the live region is mounted from the start, empty, so the text that arrives later is announced */}
      <View
        testID="startup-status"
        accessibilityLiveRegion="polite"
        style={error ? styles.message : styles.status}
      >
        {error ? (
          <>
            <Text style={styles.text}>{t('startup.error')}</Text>
            <Pressable
              accessibilityRole="button"
              testID="startup-retry"
              onPress={onRetry}
              style={styles.button}
            >
              <Text style={styles.buttonText}>{t('startup.retry')}</Text>
            </Pressable>
          </>
        ) : (
          slow && <Text style={[styles.text, styles.hint]}>{t('startup.opening')}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.background,
    padding: 32,
  },
  rays: { position: 'absolute', width: RAYS_SIZE, height: RAYS_SIZE },
  mark: { width: MARK_SIZE, height: MARK_SIZE },
  message: { alignItems: 'center', gap: 20, marginTop: 28 },
  status: { alignItems: 'center' },
  text: {
    color: palette.textMutedStrong,
    fontFamily: serifFallback,
    fontSize: 16,
    textAlign: 'center',
  },
  hint: { marginTop: 28, fontStyle: 'italic' },
  button: {
    backgroundColor: palette.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 3,
  },
  buttonText: { color: palette.onPrimary, fontFamily: serifFallback, fontSize: 16 },
});
