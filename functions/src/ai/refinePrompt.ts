// Chapter refinement prompt. Prompts are CODE: versioned
// (REFINE_PROMPT_VERSION) and covered by snapshot tests.
// ANY change here (or to the Style Bible / few-shots this prompt embeds) must
// be replayed on the whole golden set with the runner (tools/goldenSetRunner)
// BEFORE being merged; this maintenance rule is binding.
//
// Structure designed for Gemini's implicit caching: the stable prefix (Style
// Bible + few-shot + format rules) is all in the system instruction, while the
// material that changes (book/chapter context and text) is in the user text,
// at the end.

import { MAIN_KINDS, mainKindsOf, type SuggestionKind } from './refineTypes';

/**
 * Prompt version: bump on EVERY change to the text or the schema. 3 = the v1 text
 * again: the `history` rules of v2 moved to their own short calls (history/).
 */
export const REFINE_PROMPT_VERSION = 3;

/** Refinement temperature: 0.3, low to stay close to the text. */
export const REFINE_TEMPERATURE = 0.3;

export interface RefinePromptInput {
  /** Full text of the Style Bible (system instruction). */
  styleBible: string;
  /** Full text of the before/after few-shot examples. */
  fewShots: string;
  book: {
    title: string;
    genre: string;
    language: string;
    /** Book synopsis, if present: plot context. */
    synopsis: string;
  };
  chapter: {
    title: string;
    /** Chapter outline, if present. */
    outline: { summary: string; beats: string[] } | null;
  };
  /** The dictated text to refine (as the user sees it). */
  text: string;
  /** «Rifinisci la selezione»: the part to refine; `text` is then context only. */
  selection?: string;
  /** Kinds the user chose; absent or all three main kinds = the usual prompt. */
  kinds?: readonly SuggestionKind[];
}

export interface RefinePrompt {
  systemInstruction: string;
  userText: string;
  /** JSON Schema (Gemini's OpenAPI dialect) for structured output. */
  responseSchema: Record<string, unknown>;
}

/**
 * Response schema for structured output: mirrors modelSuggestionSchema
 * (refineTypes.ts) in the OpenAPI dialect. NO minItems/maxItems (the endpoint
 * rejects them with 400, verified against the endpoint): the real limits are
 * enforced by Zod and appear here only in the descriptions. NO numeric
 * offsets: the model reports the exact words (`original`) and the server
 * locates them in the text.
 */
export const REFINE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    suggestions: {
      type: 'ARRAY',
      description: 'Suggerimenti puntuali; lista vuota se il testo funziona già.',
      items: {
        type: 'OBJECT',
        properties: {
          original: {
            type: 'STRING',
            description:
              'Le parole ESATTE del testo su cui intervieni, copiate senza alcuna modifica. Il passaggio più breve possibile ma inequivocabile: deve comparire UNA SOLA volta nel testo.',
          },
          kind: {
            type: 'STRING',
            enum: ['style', 'grammar', 'pacing'],
            description: 'Categoria del suggerimento.',
          },
          rationale: {
            type: 'STRING',
            description: 'Motivazione in una riga, concreta: perché questo punto.',
          },
          proposals: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description:
              'Il testo che sostituirebbe original. grammar: esattamente 1 proposta. style e pacing: da 1 a 3 varianti, dalla più conservativa.',
          },
        },
        required: ['original', 'kind', 'rationale', 'proposals'],
        propertyOrdering: ['original', 'kind', 'rationale', 'proposals'],
      },
    },
  },
  required: ['suggestions'],
  propertyOrdering: ['suggestions'],
};

/** Serialization rules: they close the "format defined by the prompt" of the Style Bible. */
const OUTPUT_RULES = [
  '# Formato della risposta (vincolante)',
  '',
  'Rispondi SOLO con il JSON conforme allo schema richiesto, senza testo attorno.',
  'Per ogni suggerimento:',
  '- `original`: le parole esatte del testo, copiate carattere per carattere',
  '  (stessa punteggiatura, stesse maiuscole). Scegli il passaggio più breve',
  '  possibile ma inequivocabile: deve comparire una sola volta nel testo.',
  '  Un original che non combacia o che è ambiguo viene scartato.',
  '- `kind`: style, grammar o pacing, secondo le regole operative.',
  '- `rationale`: una riga concreta, nella lingua del libro.',
  '- `proposals`: il testo che sostituirebbe original. grammar: esattamente',
  '  UNA proposta. style e pacing: da 1 a 3 varianti, ordinate dalla più',
  '  conservativa. Mai una proposta identica all original.',
  'Se il testo funziona già, restituisci la lista vuota: il silenzio è una',
  'risposta giusta.',
].join('\n');

function contextBlock(input: RefinePromptInput): string {
  const lines = [
    `Libro: «${input.book.title === '' ? 'senza titolo' : input.book.title}»`,
    `Genere: ${input.book.genre === '' ? 'non indicato' : input.book.genre}`,
    `Lingua del libro: ${input.book.language === '' ? 'it' : input.book.language}`,
    `Capitolo: «${input.chapter.title === '' ? 'senza titolo' : input.chapter.title}»`,
  ];
  if (input.book.synopsis !== '') {
    lines.push(
      '',
      'Sinossi del libro (solo contesto di trama, non intervenire su di essa):',
      input.book.synopsis,
    );
  }
  const outline = input.chapter.outline;
  if (outline !== null && (outline.summary !== '' || outline.beats.length > 0)) {
    lines.push('', 'Traccia del capitolo (solo contesto: aiuta a giudicare ritmo e coerenza,');
    lines.push('NON suggerire modifiche di trama né segnalare beat mancanti):');
    if (outline.summary !== '') lines.push(outline.summary);
    outline.beats.forEach((beat, index) => lines.push(`${index + 1}. ${beat}`));
  }
  return lines.join('\n');
}

/** Builds the prompt (pure function: the snapshot test locks it). */
export function buildRefinePrompt(input: RefinePromptInput): RefinePrompt {
  const systemInstruction = [
    input.styleBible.trim(),
    '',
    '---',
    '',
    '# Esempi (few-shot): il gesto che ci si aspetta da te',
    '',
    input.fewShots.trim(),
    '',
    '---',
    '',
    OUTPUT_RULES,
  ].join('\n');

  const userText = (
    input.selection === undefined
      ? [
          contextBlock(input),
          '',
          'Testo del capitolo (dettato a voce, da rifinire con suggerimenti puntuali):',
          '<<<',
          input.text,
          '>>>',
        ]
      : [
          contextBlock(input),
          '',
          'Capitolo intero (solo contesto: non suggerire nulla fuori dalla parte da rifinire):',
          '<<<',
          input.text,
          '>>>',
          '',
          'Parte da rifinire (dettata a voce; ogni «original» deve essere copiato da qui):',
          '<<<',
          input.selection,
          '>>>',
        ]
  ).join('\n');
  const wanted = mainKindsOf(input.kinds);
  const skipped = MAIN_KINDS.filter((kind) => !wanted.includes(kind));
  const kindsNote =
    skipped.length === 0 || wanted.length === 0
      ? ''
      : `\n\nControlla SOLO: ${wanted.join(', ')}. Non proporre suggerimenti ${skipped.join(' né ')}.`;

  return {
    systemInstruction,
    userText: userText + kindsNote,
    responseSchema: REFINE_RESPONSE_SCHEMA,
  };
}
