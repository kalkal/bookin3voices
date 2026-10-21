/**
 * Dominant microphone button of the Dictation screen, 88px, three states:
 * idle (library-green circle), listening (gold circle with a pulsing ring),
 * paused (grey ring and slashed mic). In the black and gold theme primary IS
 * gold, so listening and paused used to look alike: the mic tokens keep them
 * apart in both themes. Haptics belong to the caller.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { t } from '../../i18n';
import { useTheme, type Palette } from '../../theme';

export type MicVisualState = 'idle' | 'listening' | 'paused' | 'reconnecting';

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
  reconnecting: 'dictation.mic.reconnecting',
};

export interface MicAppearance {
  icon: 'mic' | 'mic-off' | 'sync';
  iconColor: string;
  background: string;
  border?: string;
}

/** Colours and glyph per state: the state is never told by colour alone. */
export function micAppearance(state: MicVisualState, colors: Palette): MicAppearance {
  switch (state) {
    case 'listening':
      return { icon: 'mic', iconColor: colors.onMicListening, background: colors.micListening };
    case 'paused':
      return {
        icon: 'mic-off',
        iconColor: colors.micPaused,
        background: colors.surface,
        border: colors.micPaused,
      };
    case 'reconnecting':
      // gold outline, no pulse: still dictating, but the engine is off for a moment
      return {
        icon: 'sync',
        iconColor: colors.micListening,
        background: colors.surface,
        border: colors.micListening,
      };
    default:
      return { icon: 'mic', iconColor: colors.onPrimary, background: colors.primary };
  }
}

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

  const look = micAppearance(state, colors);

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
            backgroundColor: look.background,
            borderWidth: look.border !== undefined ? 2 : 0,
            borderColor: look.border,
            shadowColor: colors.shadow,
            opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons
          testID={testID ? `${testID}-icon-${look.icon}` : undefined}
          name={look.icon}
          size={36}
          color={look.iconColor}
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
