/**
 * Voice note capture (Notebook feature). Modal panel that reuses the
 * dictation engine and the chapters' voice commands, but WITHOUT the session
 * state machine or autosave: a note is dictated and saved in one go. The
 * dictated text goes through the TranscriptComposer (spoken punctuation), stays
 * hand-editable and is saved with "Salva idea" → createNote.
 * The engine is injectable (Fake in tests); the UI never touches the Firebase SDK.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Chip, OrnamentDivider, PrimaryButton } from '../../components';
import { MicControl, TranscriptComposer } from '../dictation';
import type { DictationEngine, DictationErrorCode } from '../dictation';
import { t } from '../../i18n';
import { useTheme } from '../../theme';
import { NOTE_TAGS } from './types';
import type { NoteTag } from './types';

export interface NoteCaptureModalProps {
  visible: boolean;
  /** STT engine already created by the screen (reusable between openings). */
  engine: DictationEngine;
  lang?: string;
  onCancel: () => void;
  /** Saves the note: text (already trimmed) and chosen tag (or null). */
  onSave: (text: string, tag: NoteTag | null) => void;
  /** Starting text when editing (pre-fills the editor). Default: empty. */
  initialText?: string;
  /** Starting tag when editing. Default: null. */
  initialTag?: NoteTag | null;
  /** Panel title (e.g. "Modifica idea" when editing). Default: "Nuova idea". */
  title?: string;
  /** Label of the save button. Default: "Salva idea". */
  saveLabel?: string;
}

function errorMessage(code: DictationErrorCode): string {
  const known: DictationErrorCode[] = ['permission-denied', 'audio-interruption', 'network'];
  return t(`notes.capture.err.${known.includes(code) ? code : 'unknown'}`);
}

export function NoteCaptureModal({
  visible,
  engine,
  lang = 'it-IT',
  onCancel,
  onSave,
  initialText = '',
  initialTag = null,
  title = t('notes.capture.newTitle'),
  saveLabel = t('notes.capture.save'),
}: NoteCaptureModalProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();

  // The composer accumulates the final results applying voice commands; it is rebuilt
  // from the text when the user edits by hand, so the next dictation
  // resumes from the current text. When editing, it starts from the existing text.
  const composerRef = useRef(new TranscriptComposer(initialText));
  const [text, setText] = useState(initialText);
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [tag, setTag] = useState<NoteTag | null>(initialTag);
  const [errorCode, setErrorCode] = useState<DictationErrorCode | undefined>();

  // No reinitialization in an effect: the screen remounts the panel
  // (via `key`) on every opening, so the state starts clean (new idea) or
  // pre-filled from the initial values (edit).

  // engine events while the panel is mounted; on close, listening is stopped
  // and listeners are detached (never leave the microphone on)
  useEffect(() => {
    engine.setEvents({
      onStart: () => setListening(true),
      onEnd: () => {
        setListening(false);
        setPartial('');
      },
      onPartial: (raw) => setPartial(raw),
      onFinal: (raw) => {
        setText(composerRef.current.append(raw));
        setPartial('');
      },
      onError: (error) => {
        setErrorCode(error.code);
        setListening(false);
      },
    });
    return () => {
      engine.stop().catch(() => {});
      engine.setEvents({});
    };
  }, [engine]);

  // The panel stays mounted between openings (the screen keeps it
  // alive and closes it with visible=false). On close — save, cancel or Android
  // back — the engine is stopped: without this, speech recognition
  // would keep running in the background with the microphone on. The stop emits onEnd, which
  // resets listening and the partial result in the handlers above (no setState in the effect).
  useEffect(() => {
    if (!visible) engine.stop().catch(() => {});
  }, [visible, engine]);

  const toggleMic = () => {
    setErrorCode(undefined);
    if (listening) {
      engine.stop().catch(() => {});
    } else {
      engine.start({ lang }).catch(() => setErrorCode('unknown'));
    }
  };

  const editText = (value: string) => {
    setText(value);
    composerRef.current = new TranscriptComposer(value);
  };

  const canSave = text.trim() !== '';

  const save = () => {
    if (!canSave) return;
    onSave(text.trim(), tag);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[styles.backdrop, { backgroundColor: colors.shadow }]}>
        <Card testID="note-capture-modal" style={{ width: '100%', maxWidth: 380, gap: spacing.md }}>
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: typeScale.title,
              color: colors.text,
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
          <OrnamentDivider />

          <MicControl
            state={listening ? 'listening' : 'idle'}
            status={
              errorCode
                ? errorMessage(errorCode)
                : listening
                  ? t('notes.capture.listening')
                  : t('notes.capture.idle')
            }
            onPress={toggleMic}
            testID="note-capture-mic"
            statusTestID="note-capture-caption"
          />

          <TextInput
            testID="note-capture-text"
            value={text}
            onChangeText={editText}
            placeholder={t('notes.capture.placeholder')}
            placeholderTextColor={colors.textMuted}
            multiline
            style={{
              minHeight: 96,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: radius.sharp,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 2,
              fontFamily: fonts.body,
              fontSize: typeScale.body,
              color: colors.text,
              backgroundColor: colors.background,
              textAlignVertical: 'top',
            }}
          />
          {partial !== '' ? (
            <Text
              testID="note-capture-partial"
              style={{
                fontFamily: fonts.bodyItalic,
                fontSize: typeScale.bodySmall,
                color: colors.textMuted,
              }}
            >
              {partial}
            </Text>
          ) : null}

          <View style={[styles.tagsRow, { gap: spacing.sm }]}>
            {NOTE_TAGS.map((noteTag) => (
              <Chip
                key={noteTag}
                label={noteTag}
                uppercase
                tone="gold"
                selected={tag === noteTag}
                onPress={() => setTag((current) => (current === noteTag ? null : noteTag))}
                testID={`note-capture-tag-${noteTag}`}
              />
            ))}
          </View>

          <PrimaryButton
            label={saveLabel}
            testID="note-capture-save"
            disabled={!canSave}
            onPress={save}
          />
          <Pressable
            accessibilityRole="button"
            testID="note-capture-cancel"
            onPress={onCancel}
            style={{ alignSelf: 'center', padding: spacing.xs }}
          >
            <Text
              style={{
                fontFamily: fonts.bodyItalic,
                fontSize: typeScale.bodySmall,
                color: colors.textMutedStrong,
              }}
            >
              {t('notes.capture.cancel')}
            </Text>
          </Pressable>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
});
