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
  /** Destructive actions (delete): readable on the background and on cards. */
  danger: string;
}

/** Cream "paper" theme: the alternative look, selectable in Settings. */
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
  danger: '#5C4030',
};

/**
 * Black and gold theme (mode "candlelight"): the app's DEFAULT look, taken from
 * the icon (gold #C9A24E on near-black #121012). Gold is the primary colour,
 * with dark text on top of it. Contrast (WCAG AA) is pinned by tokens.test.ts:
 * text 4.5:1, borders of controls 3:1. Shadows do not show on black, so
 * surfaces are told apart by the lighter surface tone and the gold hairlines.
 */
export const candlelightPalette: Palette = {
  background: '#121012',
  surface: '#1C191C',
  text: '#F5EFE0',
  textMuted: '#A08D68',
  textMutedStrong: '#B3A589',
  primary: '#C9A24E',
  accent: '#C9A24E',
  accentLight: '#DDBE78',
  accentText: '#C9A24E',
  hairline: '#3A332A',
  hairlineLight: '#2A2528',
  hairlineGold: '#8A7440',
  panel: '#171417',
  track: '#2A2528',
  selectedTint: '#2A2314',
  highlight: '#3A2F14',
  onPrimary: '#121012',
  onAccent: '#121012',
  statusDraft: '#7A6B50',
  coverGreen: '#24443A',
  coverLeather: '#5C4030',
  shadow: 'rgba(0, 0, 0, 0.6)',
  danger: '#F2777A',
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
