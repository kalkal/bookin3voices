/**
 * Pulsante microfono dominante della Dettatura:
 * cerchio verde biblioteca da 88px con tre stati visivi — fermo, in ascolto
 * (anello oro pulsante), in pausa (cerchio su carta con bordo verde).
 * L'aptica è del chiamante: qui solo la resa visiva e l'accessibilità.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';

export type MicVisualState = 'idle' | 'listening' | 'paused';

interface MicButtonProps {
  state: MicVisualState;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

const BUTTON_SIZE = 88;
// anello oro: il mockup lo mostra staccato di 6px dal cerchio
const RING_SIZE = BUTTON_SIZE + 16;

const ACCESSIBILITY_LABELS: Record<MicVisualState, string> = {
  idle: 'Inizia a dettare',
  listening: 'Metti in pausa la dettatura',
  paused: 'Riprendi la dettatura',
};

export function MicButton({ state, onPress, disabled = false, testID }: MicButtonProps) {
  const { colors } = useTheme();
  // Animated.Value stabile per la vita del componente (in state, non in ref:
  // leggerlo durante il render è legittimo per interpolate)
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
        accessibilityLabel={ACCESSIBILITY_LABELS[state]}
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
