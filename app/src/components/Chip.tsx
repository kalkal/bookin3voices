/**
 * Chip a pillola del mockup, in tre usi:
 * - filtro (Review): selezionato = verde pieno, altrimenti bordo oro attenuato;
 * - tag di categoria (card suggerimento): maiuscoletto con bordo oro o verde;
 * - comando vocale (Dettatura): corsivo tra virgolette basse «così».
 */
import { Pressable, Text } from 'react-native';

import { useTheme } from '../theme';

export type ChipTone = 'gold' | 'green';

interface ChipProps {
  label: string;
  onPress?: () => void;
  /** Filtro attivo: sfondo verde pieno. */
  selected?: boolean;
  /** Colore di bordo/testo quando non selezionato. */
  tone?: ChipTone;
  /** Maiuscoletto spaziato (tag di categoria). */
  uppercase?: boolean;
  /** Corsivo (comandi vocali). */
  italic?: boolean;
  testID?: string;
}

export function Chip({
  label,
  onPress,
  selected = false,
  tone,
  uppercase = false,
  italic = false,
  testID,
}: ChipProps) {
  const { colors, radius, spacing, typeScale, letterSpacing, fonts } = useTheme();

  const borderColor =
    tone === 'green' ? colors.primary : tone === 'gold' ? colors.accent : colors.hairlineGold;
  const textColor =
    tone === 'green'
      ? colors.primary
      : tone === 'gold'
        ? colors.accentText
        : colors.textMutedStrong;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
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
