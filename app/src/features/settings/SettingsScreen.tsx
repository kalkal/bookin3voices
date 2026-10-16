/**
 * Schermata Impostazioni (schermata 6 — versione FONDAMENTA):
 * Motore AI (selettore provider, oggi solo Gemini con tier Flash/Pro mostrati
 * come informazione), Scrittura (obiettivo parole giornaliero), Aspetto (tema
 * carta / a lume di candela / automatico, collegato al ThemeProvider),
 * Dati (frequenza backup con promemoria visivo e "Scarica backup ora")
 * e Profili di stile (lista statica, "Suspense/Horror" attivo — l'editing
 * è futuro). La logica vive in useSettingsController/useBackupDownload; qui solo
 * la resa.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, Chip } from '../../components';
import { useTheme } from '../../theme';
import type { ExportFileSink } from '../export';
import { DEFAULT_STYLE_ID, STYLES } from '../books/styles';
import { AI_PROVIDERS } from './aiProviders';
import { backupStatus } from './backup';
import type { BackupService } from './backup';
import { DAILY_GOAL_STEP } from './types';
import type { BackupFrequency, SettingsRepository, ThemePreference } from './types';
import { useBackupDownload } from './useBackupDownload';
import { useSettingsController } from './useSettingsController';

export interface SettingsScreenProps {
  repository: SettingsRepository;
  /** Backup Markdown: callable exportBackup + salvataggio/share sheet. */
  backupService: BackupService;
  backupFileSink: ExportFileSink;
  /** Se presente, mostra il chevron di ritorno (ingranaggio in Libreria). */
  onBack?: () => void;
}

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'paper', label: 'Carta' },
  { value: 'candlelight', label: 'A lume di candela' },
  { value: 'auto', label: 'Automatico' },
];

const BACKUP_OPTIONS: readonly { value: BackupFrequency; label: string }[] = [
  { value: 'daily', label: 'Giornaliera' },
  { value: 'weekly', label: 'Settimanale' },
  { value: 'monthly', label: 'Mensile' },
];

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
    // niente flash dei default: la schermata appare solo a documento letto
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
              accessibilityLabel="Torna alla Libreria"
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
            IMPOSTAZIONI
          </Text>
          {onBack !== undefined && <View style={styles.backButton} />}
        </View>

        <Text style={sectionLabelStyle}>Motore AI</Text>
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
                  {active ? <Chip label="Attivo" selected /> : null}
                </Pressable>
                {provider.tiers.map((tier) => (
                  <View
                    key={tier.id}
                    style={[styles.tierRow, { marginTop: spacing.sm, gap: spacing.sm }]}
                  >
                    <Chip label={tier.label} tone="gold" uppercase />
                    <Text style={[captionStyle, styles.tierDescription]}>{tier.description}</Text>
                  </View>
                ))}
              </View>
            );
          })}
          <Text style={[captionStyle, { marginTop: spacing.md }]}>
            Altri motori si potranno innestare in seguito; le rifiniture leggono il provider da
            queste impostazioni.
          </Text>
        </Card>

        <Text style={sectionLabelStyle}>Scrittura</Text>
        <Card>
          <Text style={rowTitleStyle}>Obiettivo parole giornaliero</Text>
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
            parole al giorno
          </Text>
        </Card>

        <Text style={sectionLabelStyle}>Aspetto</Text>
        <Card>
          <View style={[styles.chipRow, { gap: spacing.sm }]}>
            {THEME_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                testID={`theme-${option.value}`}
                selected={settings.theme === option.value}
                onPress={() => controller.setThemePreference(option.value)}
              />
            ))}
          </View>
        </Card>

        <Text style={sectionLabelStyle}>Dati</Text>
        <Card>
          <Text style={rowTitleStyle}>Frequenza backup</Text>
          <View style={[styles.chipRow, { gap: spacing.sm, marginTop: spacing.md }]}>
            {BACKUP_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                testID={`backup-${option.value}`}
                selected={settings.backupFrequency === option.value}
                onPress={() => controller.setBackupFrequency(option.value)}
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
            <Text style={rowTitleStyle}>Scarica backup ora</Text>
            <Text style={captionStyle}>zip di Markdown</Text>
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

        <Text style={sectionLabelStyle}>Profili di stile</Text>
        <Card>
          {STYLES.map((style) => (
            <View key={style.id} style={styles.row} testID={`style-profile-${style.id}`}>
              <Text style={rowTitleStyle}>{style.label.it}</Text>
              {style.id === DEFAULT_STYLE_ID && <Chip label="Predefinito" selected />}
            </View>
          ))}
          <Text style={[captionStyle, { marginTop: spacing.md }]}>
            Lo stile si sceglie per ogni libro, nella lista dei capitoli.
          </Text>
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
 * Promemoria visivo del backup (scelta dichiarata al posto delle
 * notifiche locali): età dell'ultimo backup, evidenziata quando supera la
 * frequenza scelta.
 */
function BackupStatusLine({ lastBackupAt, frequency }: BackupStatusLineProps) {
  const { colors, fonts, spacing, typeScale } = useTheme();
  // l'orologio si legge una volta al mount (regola di purezza del compiler):
  // per un'età espressa in giorni non serve un ticker
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
      {status.overdue ? `${status.label} — consigliato un nuovo backup` : status.label}
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
