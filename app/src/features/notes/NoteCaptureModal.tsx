/**
 * Cattura di una nota a voce (feature Taccuino). Pannello modale che riusa il
 * motore di dettatura e i comandi vocali dei capitoli, ma SENZA la macchina di
 * sessione né l'autosave: una nota si detta e si salva in un colpo ( * brief Taccuino). Il testo dettato passa dal TranscriptComposer (punteggiatura
 * a voce), resta editabile a mano e si salva con "Salva idea" → createNote.
 * Il motore è iniettabile (Fake nei test); la UI non tocca mai l'SDK Firebase.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card, Chip, OrnamentDivider, PrimaryButton } from '../../components';
import { MicButton, TranscriptComposer } from '../dictation';
import type { DictationEngine, DictationErrorCode } from '../dictation';
import { useTheme } from '../../theme';
import { NOTE_TAGS } from './types';
import type { NoteTag } from './types';

export interface NoteCaptureModalProps {
  visible: boolean;
  /** Motore STT già creato dalla schermata (riusabile tra un'apertura e l'altra). */
  engine: DictationEngine;
  lang?: string;
  onCancel: () => void;
  /** Salva la nota: testo (già trimmato) e tag scelto (o null). */
  onSave: (text: string, tag: NoteTag | null) => void;
  /** Testo di partenza in modifica (precompila l'editor). Default: vuoto. */
  initialText?: string;
  /** Tag di partenza in modifica. Default: null. */
  initialTag?: NoteTag | null;
  /** Titolo del pannello (es. "Modifica idea" in modifica). Default: "Nuova idea". */
  title?: string;
  /** Etichetta del pulsante di salvataggio. Default: "Salva idea". */
  saveLabel?: string;
}

const ERROR_MESSAGES: Partial<Record<DictationErrorCode, string>> = {
  'permission-denied': 'Permesso microfono negato: concedilo dalle impostazioni.',
  'audio-interruption': 'Il microfono è stato interrotto da un’altra app.',
  network: 'Rete assente: il riconoscimento non raggiunge il cloud.',
  unknown: 'Il motore di dettatura si è fermato in modo inatteso.',
};

export function NoteCaptureModal({
  visible,
  engine,
  lang = 'it-IT',
  onCancel,
  onSave,
  initialText = '',
  initialTag = null,
  title = 'Nuova idea',
  saveLabel = 'Salva idea',
}: NoteCaptureModalProps) {
  const { colors, fonts, spacing, radius, typeScale } = useTheme();

  // Il composer accumula i finali applicando i comandi vocali; si ricostruisce
  // dal testo quando l'utente modifica a mano, così la dettatura successiva
  // riprende dal testo corrente. In modifica parte dal testo esistente.
  const composerRef = useRef(new TranscriptComposer(initialText));
  const [text, setText] = useState(initialText);
  const [partial, setPartial] = useState('');
  const [listening, setListening] = useState(false);
  const [tag, setTag] = useState<NoteTag | null>(initialTag);
  const [errorCode, setErrorCode] = useState<DictationErrorCode | undefined>();

  // Nessuna reinizializzazione in un effetto: la schermata rimonta il pannello
  // (via `key`) a ogni apertura, così lo stato parte già pulito (nuova idea) o
  // precompilato dai valori iniziali (modifica).

  // eventi del motore mentre il pannello è montato; alla chiusura si ferma
  // l'ascolto e si sganciano i listener (mai lasciare il microfono acceso)
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

  // Il pannello resta montato tra un'apertura e l'altra (la schermata lo tiene
  // vivo e lo chiude con visible=false). Alla chiusura — salva, annulla o back
  // Android — si ferma il motore: senza questo il riconoscimento vocale
  // continuerebbe in background a microfono acceso. Lo stop emette onEnd, che
  // azzera ascolto e parziale dai gestori qui sopra (niente setState nell'effetto).
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

          <View style={styles.micRow}>
            <MicButton
              state={listening ? 'listening' : 'idle'}
              onPress={toggleMic}
              testID="note-capture-mic"
            />
          </View>
          <Text
            testID="note-capture-caption"
            style={{
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.caption,
              color: colors.textMutedStrong,
              textAlign: 'center',
            }}
          >
            {errorCode
              ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.unknown)
              : listening
                ? 'In ascolto — tocca per fermare'
                : 'Tocca il microfono e detta la tua idea'}
          </Text>

          <TextInput
            testID="note-capture-text"
            value={text}
            onChangeText={editText}
            placeholder="…oppure scrivi qui la tua idea"
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
            {NOTE_TAGS.map((t) => (
              <Chip
                key={t}
                label={t}
                uppercase
                tone="gold"
                selected={tag === t}
                onPress={() => setTag((current) => (current === t ? null : t))}
                testID={`note-capture-tag-${t}`}
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
              Annulla
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
  micRow: { alignItems: 'center' },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
});
