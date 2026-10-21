/**
 * Shared microphone control: the button plus a status line that says the
 * state in words («Sto ascoltando…», «In pausa — tocca per riprendere»). Every
 * change is announced once (announceForAccessibility works on iOS and Android;
 * a live region on top would make TalkBack read it twice), so the state is
 * never told by the icon or the colour alone.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../theme';
import { MicButton, type MicVisualState } from './MicButton';

interface MicControlProps {
  state: MicVisualState;
  /** What is happening now and what a tap does. */
  status: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  /** testID of the status line; defaults to `${testID}-status`. */
  statusTestID?: string;
}

export function MicControl({
  state,
  status,
  onPress,
  disabled,
  testID,
  statusTestID,
}: MicControlProps) {
  const { colors, fonts, spacing, typeScale } = useTheme();

  // announce changes only: the first render is read with the screen
  const announced = useRef(status);
  useEffect(() => {
    if (announced.current === status) return;
    announced.current = status;
    AccessibilityInfo.announceForAccessibility(status);
  }, [status]);

  return (
    <View style={[styles.container, { gap: spacing.md }]}>
      <MicButton state={state} onPress={onPress} disabled={disabled} testID={testID} />
      <Text
        testID={statusTestID ?? (testID ? `${testID}-status` : undefined)}
        style={[
          styles.status,
          {
            color: state === 'idle' ? colors.textMutedStrong : colors.text,
            fontFamily: state === 'listening' ? fonts.bodySemiBold : fonts.bodyItalic,
            fontSize: typeScale.caption,
          },
        ]}
      >
        {status}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  status: { textAlign: 'center' },
});
