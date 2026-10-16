/**
 * Settings screen (foundations version):
 * AI engine (provider selector, today only Gemini with Flash/Pro tiers shown
 * as information), Writing (daily word goal), Appearance (theme
 * paper / candlelight / automatic, wired to the ThemeProvider),
 * Data (backup frequency with visual reminder and "Scarica backup ora")
 * and Style profiles (static list, "Suspense/Horror" active — editing
 * is future work). Logic lives in useSettingsController/useBackupDownload; here only
 * the rendering.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Chip } from '../../components';
import { getLanguage, t } from '../../i18n';
import { useTheme } from '../../theme';
import type { ExportFileSink } from '../export';
import { DEFAULT_STYLE_ID, STYLES } from '../books/styles';
import { AI_PROVIDERS } from './aiProviders';
import { backupStatus } from './backup';
import type { BackupService } from './backup';
import { DAILY_GOAL_STEP, UI_LANGUAGES } from './types';
import type { BackupFrequency, SettingsRepository, ThemePreference } from './types';
import { useBackupDownload } from './useBackupDownload';
import { useSettingsController } from './useSettingsController';

export interface SettingsScreenProps {
  repository: SettingsRepository;
  /** Markdown backup: exportBackup callable + save/share sheet. */
  backupService: BackupService;
  backupFileSink: ExportFileSink;
  /** If present, shows the back chevron (gear icon in the Library). */
  onBack?: () => void;
}

const THEME_VALUES: readonly ThemePreference[] = ['paper', 'candlelight', 'auto'];
const BACKUP_VALUES: readonly BackupFrequency[] = ['daily', 'weekly', 'monthly'];

export function SettingsScreen({
  repository,
  backupService,
  backupFileSink,
  onBack,
}: SettingsScreenProps) {
  const { colors, fonts, spacing, typeScale, letterSpacing } = useTheme();
  const controller = useSettingsController(repository);
  const { settings } = controller;
  const backup = useBackupDownload(backupService, backupFileSink, controller.setLastBackupAt);

  const sectionLabelStyle = {
    color: colors.textMutedStrong,
    fontFamily: fonts.bodySemiBold,
    fontSize: typeScale.label,
    letterSpacing: letterSpacing.label,
    textTransform: 'uppercase' as const,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  };
  const rowTitleStyle = {
    color: colors.text,
    fontFamily: fonts.bodyMedium,
    fontSize: typeScale.body,
  };
  const captionStyle = {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: typeScale.caption,
  };

  if (!controller.ready) {
    // no flash of defaults: the screen appears only once the document is read
    return (
      <SafeAreaView
        testID="settings-screen"
        style={[styles.screen, { backgroundColor: colors.background }]}
      />
    );
  }

  return (
    <SafeAreaView
      testID="settings-screen"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.md }}>
        <View style={styles.header}>
          {onBack !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.back')}
              testID="settings-back"
              onPress={onBack}
              style={styles.backButton}
            >
              <Text style={{ color: colors.text, fontSize: typeScale.heading }}>‹</Text>
            </Pressable>
          )}
          <Text
            style={{
              flex: 1,
              color: colors.primary,
              fontFamily: fonts.body,
              fontSize: typeScale.label,
              letterSpacing: letterSpacing.label,
              textAlign: 'center',
              paddingVertical: spacing.md,
            }}
          >
            {t('settings.title')}
          </Text>
          {onBack !== undefined && <View style={styles.backButton} />}
        </View>

        <Text style={sectionLabelStyle}>{t('settings.ai.section')}</Text>
        <Card>
          {AI_PROVIDERS.map((provider) => {
            const active = settings.aiProvider === provider.id;
            return (
              <View key={provider.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  testID={`provider-${provider.id}`}
                  onPress={() => controller.setAiProvider(provider.id)}
                  style={[styles.row, { paddingVertical: spacing.xs }]}
                >
                  <Text style={rowTitleStyle}>{provider.label}</Text>
                  {active ? <Chip label={t('settings.ai.active')} selected /> : null}
                </Pressable>
                {provider.tiers.map((tier) => (
                  <View
                    key={tier.id}
                    style={[styles.tierRow, { marginTop: spacing.sm, gap: spacing.sm }]}
                  >
                    <Chip label={tier.label} tone="gold" uppercase />
                    <Text style={[captionStyle, styles.tierDescription]}>
                      {t(tier.descriptionKey)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
          <Text style={[captionStyle, { marginTop: spacing.md }]}>{t('settings.ai.note')}</Text>
        </Card>

        <Text style={sectionLabelStyle}>{t('settings.writing.section')}</Text>
        <Card>
          <Text style={rowTitleStyle}>{t('settings.writing.goal')}</Text>
          <View style={[styles.row, { marginTop: spacing.md }]}>
            <StepperButton
              label="−"
              testID="goal-decrease"
              onPress={() =>
                controller.setDailyGoalWords(settings.dailyGoalWords - DAILY_GOAL_STEP)
              }
            />
            <Text
              testID="goal-value"
              style={{
                color: colors.text,
                fontFamily: fonts.display,
                fontSize: typeScale.title,
              }}
            >
              {settings.dailyGoalWords}
            </Text>
            <StepperButton
              label="+"
              testID="goal-increase"
              onPress={() =>
                controller.setDailyGoalWords(settings.dailyGoalWords + DAILY_GOAL_STEP)
              }
            />
          </View>
          <Text style={[captionStyle, { textAlign: 'center', marginTop: spacing.xs }]}>
            {t('settings.writing.perDay')}
          </Text>
        </Card>

        <Text style={sectionLabelStyle}>{t('settings.look.section')}</Text>
        <Card>
          <View style={[styles.chipRow, { gap: spacing.sm }]}>
            {THEME_VALUES.map((value) => (
              <Chip
                key={value}
                label={t(`settings.theme.${value}`)}
                testID={`theme-${value}`}
                selected={settings.theme === value}
                onPress={() => controller.setThemePreference(value)}
              />
            ))}
          </View>
        </Card>

        <Text style={sectionLabelStyle}>{t('settings.language.section')}</Text>
        <Card>
          <View style={[styles.chipRow, { gap: spacing.sm }]}>
            {UI_LANGUAGES.map((value) => (
              <Chip
                key={value}
                label={t(`settings.language.${value}`)}
                testID={`language-${value}`}
                selected={(settings.uiLanguage ?? 'system') === value}
                onPress={() => controller.setUiLanguage(value)}
              />
            ))}
          </View>
        </Card>

        <Text style={sectionLabelStyle}>{t('settings.data.section')}</Text>
        <Card>
          <Text style={rowTitleStyle}>{t('settings.data.frequency')}</Text>
          <View style={[styles.chipRow, { gap: spacing.sm, marginTop: spacing.md }]}>
            {BACKUP_VALUES.map((value) => (
              <Chip
                key={value}
                label={t(`settings.backup.${value}`)}
                testID={`backup-${value}`}
                selected={settings.backupFrequency === value}
                onPress={() => controller.setBackupFrequency(value)}
              />
            ))}
          </View>
          <BackupStatusLine
            lastBackupAt={settings.lastBackupAt}
            frequency={settings.backupFrequency}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: backup.working }}
            disabled={backup.working}
            testID="backup-now"
            onPress={backup.download}
            style={[styles.row, { marginTop: spacing.lg }]}
          >
            <Text style={rowTitleStyle}>{t('settings.backup.now')}</Text>
            <Text style={captionStyle}>{t('settings.backup.zip')}</Text>
          </Pressable>
          {backup.progress.phase !== 'idle' && (
            <View style={[styles.backupProgress, { gap: spacing.sm, marginTop: spacing.sm }]}>
              {backup.working && <ActivityIndicator size="small" color={colors.primary} />}
              <Text
                testID="backup-progress"
                style={[
                  captionStyle,
                  styles.backupProgressText,
                  {
                    fontFamily: fonts.bodyItalic,
                    color:
                      backup.progress.phase === 'error'
                        ? colors.accentText
                        : backup.progress.phase === 'done'
                          ? colors.primary
                          : colors.textMuted,
                  },
                ]}
              >
                {backup.progress.message}
              </Text>
            </View>
          )}
        </Card>

        <Text style={sectionLabelStyle}>{t('settings.styles.section')}</Text>
        <Card>
          {STYLES.map((style) => (
            <View key={style.id} style={styles.row} testID={`style-profile-${style.id}`}>
              <Text style={rowTitleStyle}>{style.label[getLanguage()]}</Text>
              {style.id === DEFAULT_STYLE_ID && (
                <Chip label={t('settings.styles.default')} selected />
              )}
            </View>
          ))}
          <Text style={[captionStyle, { marginTop: spacing.md }]}>{t('settings.styles.note')}</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

interface BackupStatusLineProps {
  lastBackupAt: number | null;
  frequency: BackupFrequency;
}

/**
 * Visual backup reminder (declared choice instead of
 * local notifications): age of the last backup, highlighted when it exceeds the
 * chosen frequency.
 */
function BackupStatusLine({ lastBackupAt, frequency }: BackupStatusLineProps) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  // the clock is read once at mount (compiler purity rule):
  // for an age expressed in days no ticker is needed
  const [now] = useState(() => Date.now());
  const status = backupStatus(lastBackupAt, frequency, now);
  return (
    <Text
      testID="backup-status"
      style={{
        marginTop: spacing.md,
        fontFamily: status.overdue ? fonts.bodySemiBold : fonts.body,
        fontSize: typeScale.caption,
        color: status.overdue ? colors.accentText : colors.textMuted,
      }}
    >
      {status.overdue ? t('settings.backup.overdue', { label: status.label }) : status.label}
    </Text>
  );
}

interface StepperButtonProps {
  label: string;
  onPress: () => void;
  testID: string;
}

function StepperButton({ label, onPress, testID }: StepperButtonProps) {
  const { colors, fonts, typeScale } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={[styles.stepper, { borderColor: colors.hairlineGold }]}
    >
      <Text
        style={{ color: colors.primary, fontFamily: fonts.bodySemiBold, fontSize: typeScale.title }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tierDescription: {
    flexShrink: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  backupProgress: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backupProgressText: {
    flexShrink: 1,
  },
  stepper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
