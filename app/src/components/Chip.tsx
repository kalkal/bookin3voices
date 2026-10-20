/**
 * Pill chip from the mockup, in three uses:
 * - filter (Review): selected = solid green, otherwise muted gold border;
 * - category tag (suggestion card): small caps with a gold, green or (history)
 *   sealing-wax border;
 * - voice command (Dictation): italic between guillemets «like this».
 */
import { Pressable, Text } from 'react-native';

import { useTheme } from '../theme';

export type ChipTone = 'gold' | 'green' | 'history';

interface ChipProps {
  label: string;
  onPress?: () => void;
  /** Active filter: solid green background. */
  selected?: boolean;
  /** Border/text color when not selected. */
  tone?: ChipTone;
  /** Letter-spaced small caps (category tag). */
  uppercase?: boolean;
  /** Italic (voice commands). */
  italic?: boolean;
  /** Used as an on/off switch: a screen reader hears its role and its state. */
  toggle?: boolean;
  testID?: string;
}

export function Chip({
  label,
  onPress,
  selected = false,
  tone,
  uppercase = false,
  italic = false,
  toggle = false,
  testID,
}: ChipProps) {
  const { colors, radius, spacing, typeScale, letterSpacing, fonts } = useTheme();

  const toneColors: Record<ChipTone, { border: string; text: string }> = {
    green: { border: colors.primary, text: colors.primary },
    gold: { border: colors.accent, text: colors.accentText },
    history: { border: colors.history, text: colors.history },
  };
  const borderColor = tone ? toneColors[tone].border : colors.hairlineGold;
  const textColor = tone ? toneColors[tone].text : colors.textMutedStrong;

  return (
    <Pressable
      accessibilityRole={toggle ? 'switch' : onPress ? 'button' : undefined}
      accessibilityState={toggle ? { checked: selected } : undefined}
      // react-native-web ignores accessibilityState; the web switch needs aria-checked
      aria-checked={toggle ? selected : undefined}
      onPress={onPress}
      disabled={onPress === undefined}
      testID={testID}
      style={{
        alignSelf: 'flex-start',
        borderRadius: radius.pill,
        paddingVertical: uppercase ? spacing.xs / 2 : spacing.xs + 1,
        paddingHorizontal: uppercase ? spacing.md - 2 : spacing.md + 2,
        backgroundColor: selected ? colors.primary : 'transparent',
        borderWidth: selected ? 0 : 1,
        borderColor: selected ? undefined : borderColor,
      }}
    >
      <Text
        style={{
          color: selected ? colors.onPrimary : textColor,
          fontFamily: italic ? fonts.bodyItalic : fonts.body,
          fontSize: uppercase ? typeScale.micro : typeScale.caption,
          letterSpacing: uppercase ? letterSpacing.tag : undefined,
          textTransform: uppercase ? 'uppercase' : undefined,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
