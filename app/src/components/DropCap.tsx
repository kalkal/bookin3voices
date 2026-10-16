/**
 * Paragrafo con capolettera verde in Cormorant Garamond (editor).
 * React Native non ha il float del CSS: il capolettera è reso inline sulla
 * prima riga (colonna a sinistra solo per la prima riga tramite layout a due
 * colonne sarebbe l'alternativa, ma spezzerebbe il flusso del testo).
 */
import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { useTheme } from '../theme';

interface DropCapProps {
  /** Testo del paragrafo; la prima lettera diventa capolettera. */
  text: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export function DropCap({ text, style, testID }: DropCapProps) {
  const { colors, typeScale, fonts } = useTheme();
  // Primo grapheme (gestisce anche lettere accentate composte).
  const [first = '', ...rest] = Array.from(text);

  return (
    <Text
      testID={testID}
      style={[
        {
          fontFamily: fonts.body,
          fontSize: typeScale.bodyLarge,
          lineHeight: typeScale.bodyLarge * 1.8,
          color: colors.text,
        },
        style,
      ]}
    >
      <Text
        testID={testID ? `${testID}-cap` : undefined}
        style={{
          fontFamily: fonts.display,
          fontSize: typeScale.dropCap * 0.75,
          color: colors.primary,
        }}
      >
        {first}
      </Text>
      {rest.join('')}
    </Text>
  );
}
