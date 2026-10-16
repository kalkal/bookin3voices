/**
 * Design tokens for the "elegant English library" look.
 * The light palette values are those of the token table, to be used
 * as they are; the supporting tones come from the mockup.
 */
import { Platform } from 'react-native';

export interface Palette {
  /** Paper: background of all screens. */
  background: string;
  /** Card paper: cards and raised surfaces. */
  surface: string;
  /** Ink: main text. */
  text: string;
  /** Muted: secondary text, meta. */
  textMuted: string;
  /** Dark muted: captions and more readable secondary text. */
  textMutedStrong: string;
  /** Library green: primary actions, mic, "final" states. */
  primary: string;
  /** Antique gold: accents, numerals, FAB, "refined" states. */
  accent: string;
  /** Light gold: cover rules, mic ring. */
  accentLight: string;
  /** Gold readable as text on paper. */
  accentText: string;
  /** Hairline: borders and dividers. */
  hairline: string;
  /** Light hairline: row dividers in lists. */
  hairlineLight: string;
  /** Muted gold hairline: chip borders and secondary ornaments. */
  hairlineGold: string;
  /** Dictation controls panel (band under the text, from the mockup). */
  panel: string;
  /** Background of progress bars. */
  track: string;
  /** Green tint of the selected variant. */
  selectedTint: string;
  /** Inline highlight of style suggestions. */
  highlight: string;
  /** Text/icons on top of library green. */
  onPrimary: string;
  /** Text/icons on top of antique gold. */
  onAccent: string;
  /** "Draft" chapter state (neutral dot). */
  statusDraft: string;
  /** Bound cover: green. */
  coverGreen: string;
  /** Bound cover: leather. */
  coverLeather: string;
  /** Warm shadow (FAB, mic). */
  shadow: string;
}

/** Light "paper" theme — the default. */
export const paperPalette: Palette = {
  background: '#F5EFE0',
  surface: '#FBF6EA',
  text: '#2C241B',
  textMuted: '#8A7B63',
  textMutedStrong: '#6E6350',
  primary: '#2E5343',
  accent: '#A8853B',
  accentLight: '#C9A961',
  accentText: '#8A6D2F',
  hairline: '#D9CDB4',
  hairlineLight: '#E5DBC2',
  hairlineGold: '#C9B98F',
  panel: '#F0E8D3',
  track: '#E9DFC8',
  selectedTint: '#ECF0E7',
  highlight: '#F3E7C8',
  onPrimary: '#F5EFE0',
  onAccent: '#F5EFE0',
  statusDraft: '#B0A58C',
  coverGreen: '#24443A',
  coverLeather: '#5C4030',
  shadow: 'rgba(44, 36, 27, 0.25)',
};

/**
 * Dark "candlelight" theme (near-black brown background, warm amber
 * text, same accents). A sketch to refine once the real screens exist;
 * the app default remains the paper theme.
 */
export const candlelightPalette: Palette = {
  background: '#1A140B',
  surface: '#251D11',
  text: '#E9D8AE',
  textMuted: '#A08D68',
  textMutedStrong: '#BFA97D',
  primary: '#3F6B56',
  accent: '#C9A961',
  accentLight: '#C9A961',
  accentText: '#C9A961',
  hairline: '#3C3120',
  hairlineLight: '#332A1B',
  hairlineGold: '#5C4B2E',
  panel: '#211A0E',
  track: '#332A1B',
  selectedTint: '#22301F',
  highlight: '#3A2F14',
  onPrimary: '#F5EFE0',
  onAccent: '#1A140B',
  statusDraft: '#7A6B50',
  coverGreen: '#24443A',
  coverLeather: '#5C4030',
  shadow: 'rgba(0, 0, 0, 0.5)',
};

/** Spacing scale (px). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Radii: nearly sharp corners (3px), slightly rounded covers, pills. */
export const radius = {
  sharp: 3,
  cover: 2,
  pill: 999,
} as const;

/** Type scale (px), derived from the mockup. */
export const typeScale = {
  /** App title in the Library. */
  display: 34,
  /** Screen titles. */
  title: 24,
  /** Card titles and chapter numerals. */
  heading: 21,
  /** Chapter text in editor/dictation. */
  bodyLarge: 18,
  /** Card and suggestion text. */
  body: 16,
  /** Secondary body. */
  bodySmall: 15,
  /** Meta, captions, chips. */
  caption: 14,
  /** Uppercase section labels. */
  label: 13,
  /** Category tags in cards. */
  micro: 12,
  /** Drop cap. */
  dropCap: 58,
} as const;

/** Letter spacing for "title page" styles. */
export const letterSpacing = {
  display: 2,
  label: 1.5,
  tag: 1,
  button: 0.4,
} as const;

/** System serif used until the Google Fonts are loaded. */
export const serifFallback = Platform.select({
  ios: 'Georgia',
  default: 'serif',
});
