/**
 * Development showcase of the "elegant English library" design system:
 * one demo for every token and base component, for visual comparison with
 * the mockup. Reachable only in dev from App.tsx.
 */
import { ScrollView, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { Card, Chip, DropCap, OrnamentDivider, PrimaryButton, RomanNumeral } from '../components';
import { t } from '../i18n';
import { useTheme } from '../theme';

const EDITOR_SAMPLE =
  'Il caffè era ancora caldo quando Nora sentì il primo colpo alla porta. ' +
  'Ne seguì un secondo, più deciso. Il cucchiaino tintinnò contro la tazza, ' +
  "e per un attimo fu l'unico suono della casa.";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors, spacing, typeScale, letterSpacing, fonts } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <Text
        style={{
          fontFamily: fonts.body,
          fontSize: typeScale.label,
          letterSpacing: letterSpacing.label,
          textTransform: 'uppercase',
          color: colors.textMuted,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function Swatch({ name, value }: { name: string; value: string }) {
  const { colors, spacing, radius, typeScale, fonts } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: spacing.xs, width: 76 }}>
      <View
        style={{
          width: 44,
          height: 44,
          backgroundColor: value,
          borderRadius: radius.sharp,
          borderWidth: 1,
          borderColor: colors.hairline,
        }}
      />
      <Text
        style={{ fontFamily: fonts.body, fontSize: typeScale.micro, color: colors.textMutedStrong }}
      >
        {name}
      </Text>
    </View>
  );
}

export function ThemeShowcase() {
  const { mode, setMode, colors, spacing, radius, typeScale, letterSpacing, fonts } = useTheme();

  const swatches: [string, string][] = [
    [t('settings.dev.sw.paper'), colors.background],
    [t('settings.dev.sw.card'), colors.surface],
    [t('settings.dev.sw.ink'), colors.text],
    [t('settings.dev.sw.muted'), colors.textMuted],
    [t('settings.dev.sw.green'), colors.primary],
    [t('settings.dev.sw.gold'), colors.accent],
    [t('settings.dev.sw.goldLight'), colors.accentLight],
    [t('settings.dev.sw.hairline'), colors.hairline],
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: spacing.xl,
        paddingTop: spacing.xxxl * 2,
        gap: spacing.xxl,
      }}
      testID="theme-showcase"
    >
      <View style={{ alignItems: 'center', gap: spacing.sm + 2 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: typeScale.display,
            letterSpacing: letterSpacing.display,
            color: colors.text,
          }}
        >
          bookin3voice
        </Text>
        <OrnamentDivider prominent style={{ width: 180 }} />
        <Text
          style={{
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
            color: colors.textMuted,
          }}
        >
          {t('settings.dev.subtitle')}
        </Text>
      </View>

      <Section title={t('settings.dev.theme')}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip
            label={t('settings.dev.paper')}
            selected={mode === 'paper'}
            onPress={() => setMode('paper')}
            testID="mode-paper"
          />
          <Chip
            label={t('settings.dev.candlelight')}
            selected={mode === 'candlelight'}
            onPress={() => setMode('candlelight')}
            testID="mode-candlelight"
          />
        </View>
      </Section>

      <Section title={t('settings.dev.palette')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {swatches.map(([name, value]) => (
            <Swatch key={name} name={name} value={value} />
          ))}
        </View>
      </Section>

      <Section title={t('settings.dev.typography')}>
        <Text style={{ fontFamily: fonts.display, fontSize: typeScale.title, color: colors.text }}>
          {t('settings.dev.typeTitle')}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: typeScale.bodyLarge, color: colors.text }}>
          {t('settings.dev.typeBody')}
        </Text>
        <Text
          style={{
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
            color: colors.textMutedStrong,
          }}
        >
          {t('settings.dev.typeItalic')}
        </Text>
        <Text
          style={{
            fontFamily: fonts.body,
            fontSize: typeScale.label,
            letterSpacing: letterSpacing.label,
            textTransform: 'uppercase',
            color: colors.textMuted,
          }}
        >
          {t('settings.dev.typeLabel')}
        </Text>
      </Section>

      <Section title={t('settings.dev.button')}>
        <PrimaryButton label={t('settings.dev.buttonLabel')} testID="demo-primary-button" />
        <PrimaryButton label={t('settings.dev.disabled')} disabled />
      </Section>

      <Section title={t('settings.dev.chip')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip label={t('settings.dev.chipAll')} selected />
          <Chip label={t('settings.dev.chipStyle')} />
          <Chip label={t('settings.dev.chipGrammar')} />
          <Chip label={t('settings.dev.chipRhythm')} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip label={t('settings.dev.chipStyle')} tone="gold" uppercase />
          <Chip label={t('settings.dev.chipGrammar')} tone="green" uppercase />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip label={t('settings.dev.chipPeriod')} italic />
          <Chip label={t('settings.dev.chipComma')} italic />
          <Chip label={t('settings.dev.chipNewLine')} italic />
        </View>
      </Section>

      <Section title={t('settings.dev.card')}>
        <Card testID="demo-card" style={{ gap: spacing.sm + 2 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: typeScale.label,
                letterSpacing: letterSpacing.label,
                textTransform: 'uppercase',
                color: colors.textMuted,
              }}
            >
              {t('settings.dev.goalToday')}
            </Text>
            <Text
              style={{
                fontFamily: fonts.bodyItalic,
                fontSize: typeScale.caption,
                color: colors.primary,
              }}
            >
              {t('settings.dev.streak')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View
              style={{
                flex: 1,
                height: 6,
                backgroundColor: colors.track,
                borderRadius: radius.sharp,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: '64%',
                  height: 6,
                  backgroundColor: colors.primary,
                  borderRadius: radius.sharp,
                }}
              />
            </View>
            <Text
              style={{ fontFamily: fonts.body, fontSize: typeScale.bodySmall, color: colors.text }}
            >
              {t('settings.dev.progress')}
            </Text>
          </View>
        </Card>
      </Section>

      <Section title={t('settings.dev.divider')}>
        <OrnamentDivider prominent testID="demo-divider-prominent" />
        <OrnamentDivider testID="demo-divider" />
      </Section>

      <Section title={t('settings.dev.roman')}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.lg }}>
          <RomanNumeral value={1} />
          <RomanNumeral value={4} />
          <RomanNumeral value={7} testID="demo-roman" />
          <RomanNumeral value={12} size={typeScale.title} />
          <RomanNumeral value={7} color={colors.text} size={typeScale.title} />
        </View>
      </Section>

      <Section title={t('settings.dev.dropcap')}>
        <DropCap text={EDITOR_SAMPLE} testID="demo-dropcap" />
      </Section>

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}
