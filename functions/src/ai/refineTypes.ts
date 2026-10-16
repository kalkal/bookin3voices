// Tipi e schemi Zod di refineChapter.
//
// Il CONTRATTO di risposta è definito dall'app in
// app/src/features/review/types.ts (refineResultSchema): la risposta della
// callable deve validare ANCHE lì. Non esiste un pacchetto condiviso tra
// app/ e functions/, quindi qui vive la copia server (più stretta: è la
// verità sui documenti scritti in Firestore) — chi tocca uno dei due file
// aggiorna l'altro nello stesso task.
//
// Gerarchia delle proposte (assunzione validata):
// grammar = esattamente 1 proposta; style e pacing = fino a 3 varianti.

import { z } from 'zod';

export const SUGGESTION_KINDS = ['style', 'grammar', 'pacing'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/**
 * Ciò che chiediamo al MODELLO (structured output): niente offset numerici —
 * i modelli sbagliano a contare i caratteri — ma il testo esatto dello span
 * (`original`), che il server localizza nel capitolo. Un `original` che non
 * combacia col testo (assente o ambiguo) viene scartato lato server.
 */
export const modelSuggestionSchema = z.object({
  original: z.string().min(1).max(2000),
  kind: z.enum(SUGGESTION_KINDS),
  rationale: z.string().min(1).max(500),
  proposals: z.array(z.string().max(2000)).min(1).max(3),
});

export const modelOutputSchema = z.object({
  suggestions: z.array(modelSuggestionSchema).max(40),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

/**
 * Valida la risposta del modello tenendo i suggerimenti buoni: un solo
 * elemento malformato (es. `proposals: []`) non deve buttare via tutta la
 * risposta. Ritorna null solo se non resta nessun suggerimento valido
 * (allora conviene ritentare) o se manca proprio l'array `suggestions`.
 */
export function parseModelOutput(
  candidate: unknown,
): { output: ModelOutput; dropped: number } | null {
  const strict = modelOutputSchema.safeParse(candidate);
  if (strict.success) return { output: strict.data, dropped: 0 };
  const raw = (candidate as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(raw)) return null;
  const kept: ModelOutput['suggestions'] = [];
  for (const item of raw) {
    const one = modelSuggestionSchema.safeParse(item);
    if (one.success) kept.push(one.data);
  }
  if (kept.length === 0) return null;
  const output = kept.slice(0, 40);
  return { output: { suggestions: output }, dropped: raw.length - output.length };
}

/** Span di caratteri [from, to) su rawText — come nell'app. */
export const spanSchema = z
  .object({ from: z.number().int().min(0), to: z.number().int().min(0) })
  .refine((span) => span.to > span.from, { message: 'span vuoto o rovesciato' });

/** Suggerimento normalizzato: forma del documento Firestore e della risposta. */
export const suggestionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(SUGGESTION_KINDS),
    span: spanSchema,
    original: z.string().min(1),
    proposals: z.array(z.string().min(1)).min(1).max(3),
    rationale: z.string().min(1),
    state: z.literal('pending'),
    textHash: z.string().min(1),
  })
  .superRefine((sug, ctx) => {
    if (sug.kind === 'grammar' && sug.proposals.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'grammar: una sola proposta (gerarchia)',
        path: ['proposals'],
      });
    }
    if (sug.original.length !== sug.span.to - sug.span.from) {
      ctx.addIssue({
        code: 'custom',
        message: 'original non lungo quanto lo span',
        path: ['original'],
      });
    }
  });

export type Suggestion = z.infer<typeof suggestionSchema>;

/** Input della callable (specchio di RefineRequest nell'app). */
export const refineChapterInputSchema = z.object({
  bookId: z.string().min(1),
  chapterId: z.string().min(1),
  /** Testo del capitolo COME LO VEDE L'UTENTE: durante una sessione l'editor
   *  locale è il master, quindi fa fede il testo del client,
   *  non il rawText su Firestore (che il debounce può far restare indietro). */
  text: z.string().min(1).max(500_000),
  /** Hash di `text` (stesso algoritmo di textHash.ts): verifica di integrità. */
  textHash: z.string().min(1),
  /** Idempotenza: stesso requestId ⇒ stessa risposta, zero doppioni. */
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

export type RefineChapterInput = z.infer<typeof refineChapterInputSchema>;

/** Risposta della callable: valida anche con refineResultSchema dell'app. */
export interface RefineChapterResponse {
  requestId: string;
  textHash: string;
  model: string;
  promptVersion: number;
  suggestions: Suggestion[];
  /** Suggerimenti del modello scartati dal server (original non combaciante,
   *  ambiguo o proposte vuote): solo diagnostica, l'app può ignorarlo. */
  discarded: number;
}

/** Documento registro di idempotenza users/{uid}/refines/{requestId}. */
export const refineRegistryDocSchema = z.object({
  schemaVersion: z.literal(1),
  bookId: z.string().min(1),
  chapterId: z.string().min(1),
  textHash: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.number().int().min(1),
  suggestions: z.array(suggestionSchema),
  discarded: z.number().int().min(0),
  createdAt: z.number(),
});

export type RefineRegistryDoc = z.infer<typeof refineRegistryDocSchema>;

/** Sottoinsieme del documento libro utile al contesto del prompt. */
export const bookForRefineSchema = z.object({
  title: z.string().catch(''),
  genre: z.string().catch(''),
  language: z.string().catch(''),
  synopsis: z.string().catch(''),
  /** The book's chosen writing style; null/unknown resolve to the default. */
  styleProfileId: z.string().nullable().catch(null),
});

/** Sottoinsieme del documento capitolo: titolo e outline (seconda metà). */
export const chapterForRefineSchema = z.object({
  title: z.string().catch(''),
  outline: z
    .object({
      summary: z.string().catch(''),
      beats: z.array(z.string()).catch([]),
    })
    .nullable()
    .catch(null),
});

/**
 * Strategy del modello di rifinitura (come OutlineModel): implementazioni
 * vere su Gemini, finte nei test d'integrazione.
 */
export interface RefineModel {
  readonly modelName: string;
  generate(prompt: {
    systemInstruction: string;
    userText: string;
    responseSchema: Record<string, unknown>;
  }): Promise<unknown>;
}
