/**
 * Vetrina di sviluppo del design system "biblioteca inglese elegante":
 * una demo per ogni token e componente base, per il confronto visivo col
 * mockup. Raggiungibile solo in dev da App.tsx.
 */
import { ScrollView, Text, View } from 'react-native';
import type { ReactNode } from 'react';

import { Card, Chip, DropCap, OrnamentDivider, PrimaryButton, RomanNumeral } from '../components';
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
    ['carta', colors.background],
    ['card', colors.surface],
    ['inchiostro', colors.text],
    ['attenuato', colors.textMuted],
    ['verde', colors.primary],
    ['oro', colors.accent],
    ['oro chiaro', colors.accentLight],
    ['filetto', colors.hairline],
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
          Vetrina del tema — solo sviluppo
        </Text>
      </View>

      <Section title="Tema">
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Chip
            label="Carta"
            selected={mode === 'paper'}
            onPress={() => setMode('paper')}
            testID="mode-paper"
          />
          <Chip
            label="A lume di candela"
            selected={mode === 'candlelight'}
            onPress={() => setMode('candlelight')}
            testID="mode-candlelight"
          />
        </View>
      </Section>

      <Section title="Palette">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {swatches.map(([name, value]) => (
            <Swatch key={name} name={name} value={value} />
          ))}
        </View>
      </Section>

      <Section title="Tipografia">
        <Text style={{ fontFamily: fonts.display, fontSize: typeScale.title, color: colors.text }}>
          Titolo — Cormorant Garamond
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: typeScale.bodyLarge, color: colors.text }}>
          Corpo del capitolo — EB Garamond, la misura della lettura.
        </Text>
        <Text
          style={{
            fontFamily: fonts.bodyItalic,
            fontSize: typeScale.caption,
            color: colors.textMutedStrong,
          }}
        >
          Corsivo per didascalie e motivazioni dei suggerimenti.
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
          Etichetta maiuscola di sezione
        </Text>
      </Section>

      <Section title="Bottone primario">
        <PrimaryButton label="Rifinisci con AI" testID="demo-primary-button" />
        <PrimaryButton label="Disabilitato" disabled />
      </Section>

      <Section title="Chip">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip label="Tutti" selected />
          <Chip label="Stile" />
          <Chip label="Grammatica" />
          <Chip label="Ritmo" />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip label="Stile" tone="gold" uppercase />
          <Chip label="Grammatica" tone="green" uppercase />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip label="«punto»" italic />
          <Chip label="«virgola»" italic />
          <Chip label="«a capo»" italic />
        </View>
      </Section>

      <Section title="Card su carta">
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
              Obiettivo di oggi
            </Text>
            <Text
              style={{
                fontFamily: fonts.bodyItalic,
                fontSize: typeScale.caption,
                color: colors.primary,
              }}
            >
              Serie: 7 giorni
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
              512 / 800 parole
            </Text>
          </View>
        </Card>
      </Section>

      <Section title="Divisore ornamentale">
        <OrnamentDivider prominent testID="demo-divider-prominent" />
        <OrnamentDivider testID="demo-divider" />
      </Section>

      <Section title="Numerali romani">
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.lg }}>
          <RomanNumeral value={1} />
          <RomanNumeral value={4} />
          <RomanNumeral value={7} testID="demo-roman" />
          <RomanNumeral value={12} size={typeScale.title} />
          <RomanNumeral value={7} color={colors.text} size={typeScale.title} />
        </View>
      </Section>

      <Section title="Capolettera">
        <DropCap text={EDITOR_SAMPLE} testID="demo-dropcap" />
      </Section>

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
}
