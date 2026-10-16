/**
 * Picker for the book's writing style (suspense/horror, mystery, thriller).
 * The choice is saved on the book (`styleProfileId`) and the server uses it to
 * build the AI prompt for the suggestions.
 */
import { Text, View } from 'react-native';

import { Chip } from '../../components';
import { useTheme } from '../../theme';
import { resolveStyleId, STYLES } from './styles';
import type { Book } from './types';

interface StylePickerProps {
  book: Book;
  onChange: (styleId: string) => void;
}

export function StylePicker({ book, onChange }: StylePickerProps) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  const current = resolveStyleId(book.styleProfileId);
  const info = STYLES.find((style) => style.id === current);
  return (
    <View testID="style-picker" style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>
      <Text style={{ fontFamily: fonts.body, fontSize: typeScale.label, color: colors.textMuted }}>
        Stile dei suggerimenti
      </Text>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs }}
      >
        {STYLES.map((style) => (
          <Chip
            key={style.id}
            testID={`style-option-${style.id}`}
            label={style.label.it}
            selected={style.id === current}
            onPress={() => onChange(style.id)}
          />
        ))}
      </View>
      {info !== undefined && (
        <Text
          testID="style-summary"
          style={{
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
            color: colors.textMuted,
            marginTop: spacing.xs,
          }}
        >
          {info.summary.it}
        </Text>
      )}
    </View>
  );
}
