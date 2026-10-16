/**
 * Token di design "biblioteca inglese elegante".
 * I valori della palette chiara sono quelli della tabella dei token, da usare
 * tali e quali; i toni di supporto vengono dal mockup.
 */
import { Platform } from 'react-native';

export interface Palette {
  /** Carta: sfondo di tutte le schermate. */
  background: string;
  /** Carta card: card e superfici rialzate. */
  surface: string;
  /** Inchiostro: testo principale. */
  text: string;
  /** Attenuato: testi secondari, meta. */
  textMuted: string;
  /** Attenuato scuro: didascalie e testo secondario più leggibile. */
  textMutedStrong: string;
  /** Verde biblioteca: azioni primarie, mic, stati "finale". */
  primary: string;
  /** Oro antico: accenti, numerali, FAB, stati "rifinito". */
  accent: string;
  /** Oro chiaro: filetti delle copertine, anello del mic. */
  accentLight: string;
  /** Oro leggibile come testo su carta. */
  accentText: string;
  /** Filetto: bordi e divisori. */
  hairline: string;
  /** Filetto chiaro: divisori di riga negli elenchi. */
  hairlineLight: string;
  /** Filetto oro attenuato: bordi di chip e ornamenti secondari. */
  hairlineGold: string;
  /** Pannello dei controlli di dettatura (fascia sotto il testo, dal mockup). */
  panel: string;
  /** Fondo delle barre di avanzamento. */
  track: string;
  /** Tinta verde della variante selezionata. */
  selectedTint: string;
  /** Evidenziazione inline dei suggerimenti di stile. */
  highlight: string;
  /** Testo/icone sopra il verde biblioteca. */
  onPrimary: string;
  /** Testo/icone sopra l'oro antico. */
  onAccent: string;
  /** Stato capitolo "bozza" (pallino neutro). */
  statusDraft: string;
  /** Copertina rilegata: verde. */
  coverGreen: string;
  /** Copertina rilegata: cuoio. */
  coverLeather: string;
  /** Ombra calda (FAB, mic). */
  shadow: string;
}

/** Tema chiaro "carta" — il default. */
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
 * Tema scuro "a lume di candela" (fondo bruno quasi nero, testo
 * ambrato caldo, stessi accenti). Abbozzo da rifinire quando esisteranno le
 * schermate vere; il default dell'app resta il tema carta.
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

/** Scala di spaziatura (px). */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Raggi: angoli quasi vivi (3px), copertine appena smussate, pillole. */
export const radius = {
  sharp: 3,
  cover: 2,
  pill: 999,
} as const;

/** Scala tipografica (px), ricavata dal mockup. */
export const typeScale = {
  /** Titolo dell'app in Libreria. */
  display: 34,
  /** Titoli di schermata. */
  title: 24,
  /** Titoli di card e numerali dei capitoli. */
  heading: 21,
  /** Testo del capitolo in editor/dettatura. */
  bodyLarge: 18,
  /** Testo di card e suggerimenti. */
  body: 16,
  /** Corpo secondario. */
  bodySmall: 15,
  /** Meta, didascalie, chip. */
  caption: 14,
  /** Etichette maiuscole di sezione. */
  label: 13,
  /** Tag delle categorie nelle card. */
  micro: 12,
  /** Capolettera. */
  dropCap: 58,
} as const;

/** Spaziatura lettere per gli stili "da frontespizio". */
export const letterSpacing = {
  display: 2,
  label: 1.5,
  tag: 1,
  button: 0.4,
} as const;

/** Serif di sistema usato finché i Google Fonts non sono caricati. */
export const serifFallback = Platform.select({
  ios: 'Georgia',
  default: 'serif',
});
