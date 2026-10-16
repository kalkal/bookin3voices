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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Chip } from '../../components';
import { t, tn, uiLocale } from '../../i18n';
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

/** Recognized voice commands, shown in guillemets. */
const VOICE_COMMAND_HINTS = ['«punto»', '«virgola»', '«a capo»', '«nuovo paragrafo»'];

const ERROR_MESSAGE_KEYS: Record<DictationError['code'], string> = {
  'permission-denied': 'dictation.error.permissionDenied',
  'audio-interruption': 'dictation.error.audioInterruption',
  'no-speech': 'dictation.error.noSpeech',
  network: 'dictation.error.network',
  unknown: 'dictation.error.unknown',
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
            {tn('dictation.sessionWords', controller.sessionWords, {
              formatted: controller.sessionWords.toLocaleString(uiLocale()),
            })}
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
  if (controller.loadState === 'loading') return t('dictation.caption.loading');
  if (controller.loadState === 'load-error') return t('dictation.caption.loadError');
  if (controller.preflightRunning) return t('dictation.caption.preflight');
  if (controller.preflight && !controller.preflight.ok) {
    return t('dictation.caption.fixIssues');
  }
  switch (controller.sessionState) {
    case 'listening':
      return t('dictation.caption.listening');
    case 'paused':
      return controller.pausedByInterruption
        ? t('dictation.caption.pausedAuto')
        : t('dictation.caption.paused');
    case 'committing':
      return t('dictation.caption.committing');
    case 'error':
      return t(ERROR_MESSAGE_KEYS[controller.dictationError?.code ?? 'unknown']);
    default:
      return offline ? t('dictation.caption.offline') : t('dictation.caption.idle');
  }
}

function SaveIndicator({ status }: { status: 'saved' | 'pending' | 'saving' | 'error' }) {
  const { colors, fonts, typeScale, spacing } = useTheme();
  const label =
    status === 'saved'
      ? t('dictation.save.saved')
      : status === 'error'
        ? t('dictation.save.error')
        : t('dictation.save.saving');
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
              downloadOfflineModel().catch(() => {});
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
