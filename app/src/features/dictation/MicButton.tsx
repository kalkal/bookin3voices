/**
 * Dominant microphone button of the Dictation screen:
 * an 88px library-green circle with three visual states: idle, listening
 * (pulsing gold ring), paused (circle on paper with a green border).
 * Haptics belong to the caller: only rendering and accessibility live here.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { t } from '../../i18n';
import { useTheme } from '../../theme';

export type MicVisualState = 'idle' | 'listening' | 'paused';

interface MicButtonProps {
  state: MicVisualState;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

const BUTTON_SIZE = 88;
// gold ring: the mockup shows it detached 6px from the circle
const RING_SIZE = BUTTON_SIZE + 16;

const ACCESSIBILITY_LABEL_KEYS: Record<MicVisualState, string> = {
  idle: 'dictation.mic.idle',
  listening: 'dictation.mic.listening',
  paused: 'dictation.mic.paused',
};

export function MicButton({ state, onPress, disabled = false, testID }: MicButtonProps) {
  const { colors } = useTheme();
  // Animated.Value stable for the component's lifetime (in state, not in a ref:
  // reading it during render is legitimate for interpolate)
  const [pulse] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (state !== 'listening') {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, state]);

  const paused = state === 'paused';

  return (
    <View style={styles.container}>
      {state === 'listening' ? (
        <Animated.View
          testID={testID ? `${testID}-ring` : undefined}
          pointerEvents="none"
          style={[
            styles.ring,
            {
              borderColor: colors.accentLight,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.35] }),
              transform: [
                { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
              ],
            },
          ]}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(ACCESSIBILITY_LABEL_KEYS[state])}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: paused ? colors.surface : colors.primary,
            borderWidth: paused ? 2 : 0,
            borderColor: paused ? colors.primary : undefined,
            shadowColor: colors.shadow,
            opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons
          name={paused ? 'mic-outline' : 'mic'}
          size={36}
          color={paused ? colors.primary : colors.onPrimary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 4,
  },
});
