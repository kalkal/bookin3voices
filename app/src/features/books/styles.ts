// Writing styles the AI suggestions can follow (mirror of
// functions/src/ai/styles.ts: keep the ids in sync). The choice is stored per
// book in `styleProfileId`; null or an unknown id means the default.

export const STYLE_IDS = ['suspense', 'mystery', 'thriller'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

export const DEFAULT_STYLE_ID: StyleId = 'suspense';

export interface StyleInfo {
  id: StyleId;
  label: { en: string; it: string };
  summary: { en: string; it: string };
}

export const STYLES: readonly StyleInfo[] = [
  {
    id: 'suspense',
    label: { en: 'Suspense / Horror', it: 'Suspense / Horror' },
    summary: {
      en: 'Dread from a threat not yet seen; sensory detail; slow pace that accelerates.',
      it: 'Paura da una minaccia non ancora vista; dettagli dei sensi; ritmo che accelera.',
    },
  },
  {
    id: 'mystery',
    label: { en: 'Mystery (whodunit)', it: 'Mystery (giallo)' },
    summary: {
      en: 'Tension from a question; camouflaged clues, red herrings, fair play.',
      it: 'Tensione da una domanda; indizi mimetizzati, false piste, fair play.',
    },
  },
  {
    id: 'thriller',
    label: { en: 'Thriller', it: 'Thriller' },
    summary: {
      en: 'Concrete danger and a deadline; short sentences, cuts, cliffhangers.',
      it: 'Pericolo concreto e scadenza; frasi brevi, tagli, finali sospesi.',
    },
  },
];

/** Known style id, or the default for anything else. */
export function resolveStyleId(raw: unknown): StyleId {
  return (STYLE_IDS as readonly unknown[]).includes(raw) ? (raw as StyleId) : DEFAULT_STYLE_ID;
}
