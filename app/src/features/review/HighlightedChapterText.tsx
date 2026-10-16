/**
 * Testo del capitolo con evidenziazioni inline dei suggerimenti pending
 * (stile track-changes del mockup Editor):
 * - stile: fondo carta dorata + sottolineatura oro puntinata;
 * - grammatica: sottolineatura verde piena;
 * - ritmo: sottolineatura oro tratteggiata.
 * Il primo paragrafo apre col capolettera verde (firma visiva).
 */
import { Text } from 'react-native';
import type { TextStyle } from 'react-native';

import { useTheme } from '../../theme';
import type { Suggestion, SuggestionKind } from './types';

interface HighlightedChapterTextProps {
  text: string;
  suggestions: readonly Suggestion[];
  /** Tap su un'evidenziazione (per saltare alla Review). */
  onPressSuggestion?: (suggestionId: string) => void;
  testID?: string;
}

interface Segment {
  text: string;
  suggestion?: Suggestion;
}

export function HighlightedChapterText({
  text,
  suggestions,
  onPressSuggestion,
  testID,
}: HighlightedChapterTextProps) {
  const { colors, fonts, spacing, typeScale } = useTheme();

  const pending = [...suggestions]
    .filter((s) => s.state === 'pending')
    .sort((a, b) => a.span.from - b.span.from);

  const kindStyle: Record<SuggestionKind, TextStyle> = {
    style: {
      backgroundColor: colors.highlight,
      textDecorationLine: 'underline',
      textDecorationStyle: 'dotted',
      textDecorationColor: colors.accent,
    },
    grammar: {
      textDecorationLine: 'underline',
      textDecorationStyle: 'solid',
      textDecorationColor: colors.primary,
    },
    pacing: {
      textDecorationLine: 'underline',
      textDecorationStyle: 'dashed',
      textDecorationColor: colors.accentText,
    },
  };

  const paragraphs = splitParagraphs(text);
  const dropCapIndex = paragraphs.findIndex((p) => p.text.trim() !== '');

  return (
    <>
      {paragraphs.map((paragraph, index) => {
        const cap = index === dropCapIndex ? (Array.from(paragraph.text)[0] ?? '') : '';
        const capLength = cap.length;
        const segments = segmentsFor(
          paragraph.text.slice(capLength),
          paragraph.start + capLength,
          pending,
        );
        return (
          <Text
            key={paragraph.start}
            testID={testID ? `${testID}-p${index}` : undefined}
            style={{
              color: colors.text,
              fontFamily: fonts.body,
              fontSize: typeScale.bodyLarge,
              lineHeight: Math.round(typeScale.bodyLarge * 1.8),
              marginTop: index === 0 ? 0 : spacing.md + 2,
            }}
          >
            {cap !== '' ? (
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: typeScale.dropCap * 0.75,
                  color: colors.primary,
                }}
              >
                {cap}
              </Text>
            ) : null}
            {segments.map((segment, segmentIndex) => {
              const suggestion = segment.suggestion;
              return suggestion ? (
                <Text
                  key={segmentIndex}
                  testID={`highlight-${suggestion.id}`}
                  onPress={onPressSuggestion ? () => onPressSuggestion(suggestion.id) : undefined}
                  style={kindStyle[suggestion.kind]}
                >
                  {segment.text}
                </Text>
              ) : (
                <Text key={segmentIndex}>{segment.text}</Text>
              );
            })}
          </Text>
        );
      })}
    </>
  );
}

interface Paragraph {
  text: string;
  /** Offset del primo carattere nel testo intero. */
  start: number;
}

function splitParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let start = 0;
  for (const piece of text.split('\n')) {
    if (piece.trim() !== '') {
      paragraphs.push({ text: piece, start });
    }
    start += piece.length + 1;
  }
  return paragraphs.length > 0 ? paragraphs : [{ text, start: 0 }];
}

/** Spezza un paragrafo in tratti pieni/evidenziati sui pending che lo toccano. */
function segmentsFor(text: string, offset: number, pending: readonly Suggestion[]): Segment[] {
  const end = offset + text.length;
  const segments: Segment[] = [];
  let cursor = offset;
  for (const suggestion of pending) {
    const from = Math.max(suggestion.span.from, offset);
    const to = Math.min(suggestion.span.to, end);
    if (to <= cursor || from >= end) continue;
    if (from > cursor) {
      segments.push({ text: text.slice(cursor - offset, from - offset) });
    }
    segments.push({ text: text.slice(from - offset, to - offset), suggestion });
    cursor = to;
  }
  if (cursor < end) {
    segments.push({ text: text.slice(cursor - offset) });
  }
  return segments;
}
