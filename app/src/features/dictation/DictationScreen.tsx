/**
 * Dictation screen (the core screen):
 * full-screen live text (interim results dimmed grey, finalized text in
 * ink), a bottom panel with the session word counter, save and offline
 * indicators, voice-command chips and a dominant three-state microphone.
 * The pre-flight appears as a card above the text.
 * All logic lives in useDictationController; only rendering is here.
 */
import { Ionicons } from '@expo/vector-icons';
import { useNetworkState } from 'expo-network';
import { useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Chip, Screen, useBottomClearance } from '../../components';
import { t, tn, uiLocale } from '../../i18n';
import { useTheme } from '../../theme';
import type { ChapterRef, ChapterTextRepository, KeyValueStorage } from '../chapters';
import { ExpoDictationEngine } from './engines/ExpoDictationEngine';
import type { MicVisualState } from './MicButton';
import { MicControl } from './MicControl';
import { OutlineTrack, type OutlineTrackRepository } from './OutlineTrack';
import { commandLanguage, dictationLocale } from './dictationLanguage';
import { downloadOfflineModel, type PreflightChecks, type PreflightIssue } from './preflight';
import type { AutoPauseReason } from './DictationSession';
import type { DictationEngine, DictationError } from './types';
import { useDictationController } from './useDictationController';
import type { SaveStatus } from './autosave';
import { stopCommandPhrase, voiceCommandPhrases } from './voiceCommands';

export interface DictationScreenProps {
  chapter: ChapterRef;
  /** Screen header, e.g. "Capitolo I". */
  chapterTitle?: string;
  repository: ChapterTextRepository;
  /** STT engine; defaults to ExpoDictationEngine. Tests pass the Fake. */
  engine?: DictationEngine;
  preflightChecks?: PreflightChecks;
  debounceMs?: number;
  lang?: string;
  /** If present, shows the back chevron to the Book. */
  onBack?: () => void;
  /**
   * If present and the chapter has an `outline`, shows the collapsible
   * track with the beats. Absent (or chapter without an outline): no
   * panel, the screen stays as it always was.
   */
  outlineRepository?: OutlineTrackRepository;
  /** Storage for the track's open/closed state; defaults to AsyncStorage. */
  outlineStateStorage?: KeyValueStorage;
}

const ERROR_MESSAGE_KEYS: Record<DictationError['code'], string> = {
  'permission-denied': 'dictation.error.permissionDenied',
  'audio-interruption': 'dictation.error.audioInterruption',
  'no-speech': 'dictation.error.noSpeech',
  network: 'dictation.error.network',
  busy: 'dictation.error.busy',
  unknown: 'dictation.error.unknown',
};

const AUTO_PAUSE_KEYS: Record<AutoPauseReason, string> = {
  'audio-interruption': 'dictation.caption.pausedAuto',
  silence: 'dictation.caption.pausedSilence',
  'engine-unavailable': 'dictation.caption.pausedEngine',
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
  const panelBottom = useBottomClearance(spacing.xl);
  // the ONE resolution of the dictation language: recognizer, commands, hints
  // frozen for the session, like the engine and the session it feeds
  const [locale] = useState(() => dictationLocale(lang));
  const scrollRef = useRef<ScrollView>(null);
  const [dismissedWarnings, setDismissedWarnings] = useState<ReadonlySet<string>>(new Set());

  // the native engine is created only once, and only if none was injected
  const resolvedEngine = useMemo<DictationEngine>(
    () => engine ?? new ExpoDictationEngine(),
    // fixed for the screen's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const controller = useDictationController({
    engine: resolvedEngine,
    repository,
    chapter,
    debounceMs,
    lang: locale,
    preflightChecks,
  });

  const network = useNetworkState();
  const offline = network.isConnected === false;

  const micState: MicVisualState =
    controller.sessionState === 'listening'
      ? controller.reconnecting
        ? 'reconnecting'
        : 'listening'
      : controller.sessionState === 'paused'
        ? 'paused'
        : 'idle';

  const caption = captionFor(controller, offline);

  const visibleIssues = (controller.preflight?.issues ?? []).filter(
    (issue) => issue.severity === 'blocker' || !dismissedWarnings.has(issue.id),
  );

  return (
    <Screen testID="dictation-screen">
      {chapterTitle || onBack !== undefined ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {onBack !== undefined ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('dictation.backToBook')}
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
          // from the header "Capitolo VII · Titolo" only "Capitolo VII" reaches
          // the panel (mockup label: "Traccia · Capitolo VII")
          chapterLabel={chapterTitle?.split('·')[0]?.trim()}
          storage={outlineStateStorage}
        />
      ) : null}

      {visibleIssues.map((issue) => (
        <PreflightIssueCard
          key={issue.id}
          issue={issue}
          locale={locale}
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
            {t('dictation.loadError')}
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
            {t('dictation.emptyHint')}
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
            paddingBottom: panelBottom,
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
            {tn('dictation.sessionWords', controller.sessionWords, {
              formatted: controller.sessionWords.toLocaleString(uiLocale()),
            })}
          </Text>
          <SaveIndicator status={controller.saveStatus} offline={offline} />
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
          {/* the commands, also tappable: the sign goes in as if dictated */}
          {voiceCommandPhrases(commandLanguage(locale)).map((phrase) => {
            // «ferma dettatura» only acts while the microphone listens
            const isStop = phrase === stopCommandPhrase(commandLanguage(locale));
            const enabled = isStop
              ? controller.sessionState === 'listening'
              : controller.canInsertCommand;
            return (
              <Chip
                key={phrase}
                label={`«${phrase}»`}
                italic
                disabled={!enabled}
                onPress={() => controller.insertCommand(phrase)}
                testID={`dictation-command-${phrase.replace(/ /g, '-')}`}
              />
            );
          })}
        </View>

        <MicControl
          state={micState}
          status={caption}
          disabled={controller.micDisabled}
          onPress={controller.toggleMic}
          testID="dictation-mic"
          statusTestID="dictation-caption"
        />
      </View>
    </Screen>
  );
}

function captionFor(
  controller: ReturnType<typeof useDictationController>,
  offline: boolean,
): string {
  if (controller.loadState === 'loading') return t('dictation.caption.loading');
  if (controller.loadState === 'load-error') return t('dictation.caption.loadError');
  if (controller.preflightRunning) return t('dictation.caption.preflight');
  if (controller.preflight && !controller.preflight.ok) {
    return t('dictation.caption.fixIssues');
  }
  switch (controller.sessionState) {
    case 'listening':
      return controller.reconnecting
        ? t('dictation.caption.reconnecting')
        : t('dictation.caption.listening');
    case 'paused':
      return controller.autoPauseReason !== undefined
        ? t(AUTO_PAUSE_KEYS[controller.autoPauseReason])
        : t('dictation.caption.paused');
    case 'committing':
      return t('dictation.caption.committing');
    case 'error':
      return t(ERROR_MESSAGE_KEYS[controller.dictationError?.code ?? 'unknown']);
    default:
      return offline ? t('dictation.caption.offline') : t('dictation.caption.idle');
  }
}

function SaveIndicator({ status, offline }: { status: SaveStatus; offline: boolean }) {
  const { colors, fonts, typeScale, spacing } = useTheme();
  // nothing saved yet in this session: no claim at all
  if (status === 'idle') return null;
  // offline Firestore only queues the write in RAM: the safe copy is the phone's
  const onPhoneOnly = status === 'saved-local' || (status === 'saved' && offline);
  const label = onPhoneOnly
    ? t('dictation.save.savedLocal')
    : status === 'saved'
      ? t('dictation.save.saved')
      : status === 'error'
        ? t('dictation.save.error')
        : t('dictation.save.saving');
  const icon: keyof typeof Ionicons.glyphMap | null = onPhoneOnly
    ? 'phone-portrait-outline'
    : status === 'saved'
      ? 'checkmark'
      : status === 'error'
        ? 'alert-circle-outline'
        : null;
  const color =
    status === 'saved' || onPhoneOnly
      ? colors.primary
      : status === 'error'
        ? colors.accentText
        : colors.textMuted;
  return (
    <View
      style={[styles.inlineBadge, { gap: spacing.xs }]}
      testID="dictation-save-indicator"
      accessibilityLiveRegion="polite"
    >
      {icon !== null ? <Ionicons name={icon} size={15} color={color} /> : null}
      <Text style={{ color, fontFamily: fonts.body, fontSize: typeScale.caption }}>{label}</Text>
    </View>
  );
}

function PreflightIssueCard({
  issue,
  locale,
  onRetry,
  onDismiss,
}: {
  issue: PreflightIssue;
  /** Recognition locale: the offline pack to download is the dictation language's. */
  locale: string;
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
            label={t('dictation.preflight.openSettings')}
            tone="green"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
            testID="preflight-action-open-settings"
          />
        ) : null}
        {issue.action === 'download-offline-model' ? (
          <Chip
            label={t('dictation.preflight.downloadOffline')}
            tone="green"
            onPress={() => {
              downloadOfflineModel(locale).catch(() => {});
            }}
            testID="preflight-action-download-offline-model"
          />
        ) : null}
        <Chip
          label={t('dictation.preflight.retry')}
          onPress={onRetry}
          testID={`preflight-retry-${issue.id}`}
        />
        {onDismiss ? (
          <Chip
            label={t('dictation.preflight.dismiss')}
            onPress={onDismiss}
            testID={`preflight-dismiss-${issue.id}`}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
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
  inlineBadge: { flexDirection: 'row', alignItems: 'center' },
});
