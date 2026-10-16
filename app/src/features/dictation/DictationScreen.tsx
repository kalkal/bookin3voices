/**
 * Schermata Dettatura (la schermata cuore):
 * testo live a schermo intero (parziali in grigio attenuato, consolidato in
 * inchiostro), pannello inferiore con contatore parole di sessione, indicatore
 * di salvataggio e offline, chip dei comandi vocali «così» e microfono
 * dominante a tre stati. Il pre-flight appare come card sopra il testo.
 * Tutta la logica vive in useDictationController; qui solo la resa.
 */
import { Ionicons } from '@expo/vector-icons';
import { useNetworkState } from 'expo-network';
import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Chip } from '../../components';
import { useTheme } from '../../theme';
import type { ChapterRef, ChapterTextRepository, KeyValueStorage } from '../chapters';
import { ExpoDictationEngine } from './engines/ExpoDictationEngine';
import { MicButton, type MicVisualState } from './MicButton';
import { OutlineTrack, type OutlineTrackRepository } from './OutlineTrack';
import { downloadOfflineModel, type PreflightChecks, type PreflightIssue } from './preflight';
import type { DictationEngine, DictationError } from './types';
import { useDictationController } from './useDictationController';

export interface DictationScreenProps {
  chapter: ChapterRef;
  /** Intestazione della schermata, es. "Capitolo I". */
  chapterTitle?: string;
  repository: ChapterTextRepository;
  /** Motore STT; default ExpoDictationEngine. I test passano il Fake. */
  engine?: DictationEngine;
  preflightChecks?: PreflightChecks;
  debounceMs?: number;
  lang?: string;
  /** Se presente, mostra il chevron di ritorno al Libro. */
  onBack?: () => void;
  /**
   * Se presente e il capitolo ha un `outline`, mostra la traccia
   * richiudibile coi beat. Assente (o capitolo senza outline): niente
   * pannello, la schermata resta quella di sempre.
   */
  outlineRepository?: OutlineTrackRepository;
  /** Storage dello stato apri/chiuso della traccia; default AsyncStorage. */
  outlineStateStorage?: KeyValueStorage;
}

/** Comandi vocali riconosciuti, mostrati tra virgolette basse. */
const VOICE_COMMAND_HINTS = ['«punto»', '«virgola»', '«a capo»', '«nuovo paragrafo»'];

const ERROR_MESSAGES: Record<DictationError['code'], string> = {
  'permission-denied': 'Permesso microfono negato: concedilo dalle impostazioni.',
  'audio-interruption': 'Il microfono è stato interrotto da un’altra app.',
  'no-speech': 'Il motore non sente parlato da un po’.',
  network: 'Rete assente: il riconoscimento non raggiunge il cloud.',
  unknown: 'Il motore di dettatura si è fermato in modo inatteso.',
};

export function DictationScreen({
  chapter,
  chapterTitle,
  repository,
  engine,
  preflightChecks,
  debounceMs,
  lang,
  onBack,
  outlineRepository,
  outlineStateStorage,
}: DictationScreenProps) {
  const { colors, fonts, spacing, typeScale, letterSpacing } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const [dismissedWarnings, setDismissedWarnings] = useState<ReadonlySet<string>>(new Set());

  // il motore nativo si crea una sola volta, e solo se non è stato iniettato
  const resolvedEngine = useMemo<DictationEngine>(
    () => engine ?? new ExpoDictationEngine(),
    // fisso per la vita della schermata
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const controller = useDictationController({
    engine: resolvedEngine,
    repository,
    chapter,
    debounceMs,
    lang,
    preflightChecks,
  });

  const network = useNetworkState();
  const offline = network.isConnected === false;

  const micState: MicVisualState =
    controller.sessionState === 'listening'
      ? 'listening'
      : controller.sessionState === 'paused'
        ? 'paused'
        : 'idle';

  const caption = captionFor(controller, offline);

  const visibleIssues = (controller.preflight?.issues ?? []).filter(
    (issue) => issue.severity === 'blocker' || !dismissedWarnings.has(issue.id),
  );

  return (
    <SafeAreaView
      testID="dictation-screen"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      {chapterTitle || onBack !== undefined ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onBack !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Torna al Libro"
              testID="dictation-back"
              onPress={onBack}
              style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: colors.text, fontSize: typeScale.heading }}>‹</Text>
            </Pressable>
          ) : null}
          <Text
            style={[
              styles.header,
              {
                flex: 1,
                color: colors.primary,
                fontFamily: fonts.body,
                fontSize: typeScale.label,
                letterSpacing: letterSpacing.label,
                paddingVertical: spacing.md,
              },
            ]}
          >
            {(chapterTitle ?? '').toUpperCase()}
          </Text>
          {onBack !== undefined ? <View style={{ width: 40 }} /> : null}
        </View>
      ) : null}

      {outlineRepository !== undefined ? (
        <OutlineTrack
          chapter={chapter}
          repository={outlineRepository}
          // dall'intestazione "Capitolo VII · Titolo" al pannello resta solo
          // "Capitolo VII" (etichetta del mockup: "Traccia · Capitolo VII")
          chapterLabel={chapterTitle?.split('·')[0]?.trim()}
          storage={outlineStateStorage}
        />
      ) : null}

      {visibleIssues.map((issue) => (
        <PreflightIssueCard
          key={issue.id}
          issue={issue}
          onRetry={controller.rerunPreflight}
          onDismiss={
            issue.severity === 'warning'
              ? () => setDismissedWarnings((prev) => new Set(prev).add(issue.id))
              : undefined
          }
        />
      ))}

      <ScrollView
        ref={scrollRef}
        style={styles.textArea}
        contentContainerStyle={{ padding: spacing.xxl, paddingTop: spacing.lg }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {controller.loadState === 'load-error' ? (
          <Text
            testID="dictation-load-error"
            style={{ color: colors.textMutedStrong, fontFamily: fonts.bodyItalic }}
          >
            Impossibile leggere il capitolo salvato. Chiudi e riapri l’app; se il problema resta,
            non dettare: il testo nuovo non si aggancerebbe a quello esistente.
          </Text>
        ) : controller.fullText === '' && controller.partial === '' ? (
          <Text
            testID="dictation-empty-hint"
            style={{
              color: colors.textMuted,
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.body,
              textAlign: 'center',
              paddingTop: spacing.xxxl,
            }}
          >
            Tocca il microfono e inizia a dettare:{'\n'}il testo apparirà qui.
          </Text>
        ) : (
          <Text
            testID="dictation-live-text"
            selectable
            style={{
              color: colors.text,
              fontFamily: fonts.body,
              fontSize: typeScale.bodyLarge + 1,
              lineHeight: Math.round((typeScale.bodyLarge + 1) * 1.75),
            }}
          >
            {controller.fullText}
            {controller.partial !== '' ? (
              <Text
                testID="dictation-partial"
                style={{ color: colors.textMuted, fontFamily: fonts.bodyItalic }}
              >
                {controller.fullText === '' ? '' : ' '}
                {controller.partial}
              </Text>
            ) : null}
          </Text>
        )}
      </ScrollView>

      <View
        style={[
          styles.panel,
          {
            backgroundColor: colors.panel,
            borderTopColor: colors.hairline,
            paddingHorizontal: spacing.xxl,
            paddingTop: spacing.lg,
            paddingBottom: spacing.xl,
            gap: spacing.md,
          },
        ]}
      >
        <View style={[styles.statusRow, { gap: spacing.lg }]}>
          <Text
            testID="dictation-words"
            style={{
              color: colors.textMutedStrong,
              fontFamily: fonts.body,
              fontSize: typeScale.caption,
            }}
          >
            {controller.sessionWords.toLocaleString('it-IT')}{' '}
            {controller.sessionWords === 1 ? 'parola' : 'parole'} in questa sessione
          </Text>
          <SaveIndicator status={controller.saveStatus} />
          {offline ? (
            <View style={[styles.inlineBadge, { gap: spacing.xs }]} testID="dictation-offline">
              <Ionicons name="cloud-offline-outline" size={14} color={colors.accentText} />
              <Text
                style={{
                  color: colors.accentText,
                  fontFamily: fonts.body,
                  fontSize: typeScale.caption,
                }}
              >
                Offline
              </Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.chipsRow, { gap: spacing.sm }]}>
          {VOICE_COMMAND_HINTS.map((hint) => (
            <Chip key={hint} label={hint} italic />
          ))}
        </View>

        <View style={styles.micRow}>
          <MicButton
            state={micState}
            disabled={controller.micDisabled}
            onPress={controller.toggleMic}
            testID="dictation-mic"
          />
        </View>

        <Text
          testID="dictation-caption"
          style={[
            styles.caption,
            {
              color: colors.textMutedStrong,
              fontFamily: fonts.bodyItalic,
              fontSize: typeScale.caption,
            },
          ]}
        >
          {caption}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function captionFor(
  controller: ReturnType<typeof useDictationController>,
  offline: boolean,
): string {
  if (controller.loadState === 'loading') return 'Apertura del capitolo…';
  if (controller.loadState === 'load-error') return 'Capitolo non leggibile';
  if (controller.preflightRunning) return 'Controllo di microfono e lingua…';
  if (controller.preflight && !controller.preflight.ok) {
    return 'Risolvi i problemi qui sopra per dettare';
  }
  switch (controller.sessionState) {
    case 'listening':
      return 'In ascolto — tocca per mettere in pausa';
    case 'paused':
      return controller.pausedByInterruption
        ? 'In pausa automatica (audio interrotto) — tocca per riprendere'
        : 'In pausa — tocca per riprendere';
    case 'committing':
      return 'Chiusura della dettatura…';
    case 'error':
      return ERROR_MESSAGES[controller.dictationError?.code ?? 'unknown'];
    default:
      return offline
        ? 'Sei offline: senza pacchetto lingua la dettatura può fermarsi'
        : 'Tocca il microfono per dettare';
  }
}

function SaveIndicator({ status }: { status: 'saved' | 'pending' | 'saving' | 'error' }) {
  const { colors, fonts, typeScale, spacing } = useTheme();
  const label =
    status === 'saved' ? 'Salvato' : status === 'error' ? 'Non salvato' : 'Salvataggio…';
  const color =
    status === 'saved' ? colors.primary : status === 'error' ? colors.accentText : colors.textMuted;
  return (
    <View style={[styles.inlineBadge, { gap: spacing.xs }]} testID="dictation-save-indicator">
      {status === 'saved' ? <Ionicons name="checkmark" size={15} color={color} /> : null}
      <Text style={{ color, fontFamily: fonts.body, fontSize: typeScale.caption }}>{label}</Text>
    </View>
  );
}

function PreflightIssueCard({
  issue,
  onRetry,
  onDismiss,
}: {
  issue: PreflightIssue;
  onRetry: () => void;
  onDismiss?: () => void;
}) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  return (
    <Card
      testID={`preflight-issue-${issue.id}`}
      style={{ marginHorizontal: spacing.xl, marginBottom: spacing.sm, gap: spacing.sm }}
    >
      <Text
        style={{ color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: typeScale.body }}
      >
        {issue.title}
      </Text>
      <Text
        style={{
          color: colors.textMutedStrong,
          fontFamily: fonts.body,
          fontSize: typeScale.bodySmall,
        }}
      >
        {issue.detail}
      </Text>
      <View style={[styles.chipsRow, { gap: spacing.sm }]}>
        {issue.action === 'open-settings' ? (
          <Chip
            label="Apri impostazioni"
            tone="green"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
            testID="preflight-action-open-settings"
          />
        ) : null}
        {issue.action === 'download-offline-model' ? (
          <Chip
            label="Scarica l’italiano offline"
            tone="green"
            onPress={() => {
              downloadOfflineModel().catch(() => {});
            }}
            testID="preflight-action-download-offline-model"
          />
        ) : null}
        <Chip label="Ricontrolla" onPress={onRetry} testID={`preflight-retry-${issue.id}`} />
        {onDismiss ? (
          <Chip label="Ignora" onPress={onDismiss} testID={`preflight-dismiss-${issue.id}`} />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { textAlign: 'center' },
  textArea: { flex: 1 },
  panel: {
    borderTopWidth: 1,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  micRow: { alignItems: 'center' },
  caption: { textAlign: 'center' },
  inlineBadge: { flexDirection: 'row', alignItems: 'center' },
});
