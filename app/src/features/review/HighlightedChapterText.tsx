/**
 * Chapter text with inline highlights of the pending suggestions
 * (track-changes style from the Editor mockup):
 * - style: golden paper background + dotted gold underline;
 * - grammar: solid green underline;
 * - pacing: dashed gold underline;
 * - history: double sealing-wax underline (period details, anachronisms).
 * The first paragraph opens with a green drop cap (visual signature).
 */
import { Text } from 'react-native';
import type { TextStyle } from 'react-native';

import { useTheme } from '../../theme';
import type { Suggestion, SuggestionKind } from './types';

interface HighlightedChapterTextProps {
  text: string;
  suggestions: readonly Suggestion[];
  /** Tap on a highlight (to jump to the Review). */
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
    history: {
      textDecorationLine: 'underline',
      textDecorationStyle: 'double',
      textDecorationColor: colors.history,
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
  /** Offset of the first character in the whole text. */
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

/** Splits a paragraph into plain/highlighted runs over the pendings that touch it. */
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
