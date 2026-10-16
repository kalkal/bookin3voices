// Prompt della rifinitura capitolo. I prompt sono CODICE (
//): versionati (REFINE_PROMPT_VERSION) e coperti da snapshot test.
// QUALSIASI modifica qui (o alla Style Bible / few-shots che questo prompt
// ingloba) va rigiocata sull'intero golden set col runner
// (tools/goldenSetRunner) PRIMA di essere integrata — regola di manutenzione
// vincolante.
//
// Struttura pensata per il caching implicito di Gemini: il
// prefisso stabile (Style Bible + few-shot + regole di formato) sta tutto
// nella system instruction, il materiale che cambia (contesto libro/capitolo
// e testo) sta nello user text, in coda.

/** Versione del prompt: da incrementare a OGNI modifica del testo o dello schema. */
export const REFINE_PROMPT_VERSION = 1;

/** Temperatura della rifinitura: 0.3, bassa per restare vicini al testo. */
export const REFINE_TEMPERATURE = 0.3;

export interface RefinePromptInput {
  /** Testo integrale della Style Bible (system instruction). */
  styleBible: string;
  /** Testo integrale dei few-shot before/after. */
  fewShots: string;
  book: {
    title: string;
    genre: string;
    language: string;
    /** Sinossi del libro, se presente: contesto di trama (seconda metà dell’outline). */
    synopsis: string;
  };
  chapter: {
    title: string;
    /** Outline del capitolo, se presente. */
    outline: { summary: string; beats: string[] } | null;
  };
  /** Il testo dettato da rifinire (come lo vede l'utente). */
  text: string;
}

export interface RefinePrompt {
  systemInstruction: string;
  userText: string;
  /** JSON Schema (dialetto OpenAPI di Gemini) per lo structured output. */
  responseSchema: Record<string, unknown>;
}

/**
 * Schema di risposta per lo structured output: rispecchia modelSuggestionSchema
 * (refineTypes.ts) nel dialetto OpenAPI. NIENTE minItems/maxItems (l'endpoint
 * li rifiuta con 400, verificato sull'endpoint): i limiti veri li fa rispettare
 * Zod, qui vivono solo nelle description. NIENTE offset numerici: il modello
 * riporta le parole esatte (`original`) e il server le localizza nel testo.
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

/** Regole di serializzazione: chiudono il «formato definito dal prompt» della Style Bible. */
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

/** Costruisce il prompt (funzione pura: lo snapshot test la blocca). */
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

  const userText = [
    contextBlock(input),
    '',
    'Testo del capitolo (dettato a voce, da rifinire con suggerimenti puntuali):',
    '<<<',
    input.text,
    '>>>',
  ].join('\n');

  return {
    systemInstruction,
    userText,
    responseSchema: REFINE_RESPONSE_SCHEMA,
  };
}
