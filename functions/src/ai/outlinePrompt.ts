// Outline generation prompt. Prompts are CODE: versioned
// (OUTLINE_PROMPT_VERSION) and covered by snapshot tests; a refactor must not
// change them silently, and an intentional change updates the version and the
// snapshot together.
//
// Rules built into the prompt: chapters already written are untouchable
// context; the model does NOT propose them again, and the outline continues
// from where the book has got to. The real additive merge still belongs to the
// app: the prompt is the first line of defense, not the guarantee.

/** Prompt version: bump on EVERY change to the text or the schema. */
export const OUTLINE_PROMPT_VERSION = 1;

export interface OutlinePromptInput {
  synopsis: string;
  book: {
    title: string;
    genre: string;
    language: string;
  };
  /** Titles of chapters with text (non-empty rawText), in order: context only. */
  writtenChapterTitles: string[];
}

/** Prompt ready for the model: instructions, user text and response schema. */
export interface OutlinePrompt {
  systemInstruction: string;
  userText: string;
  /** JSON Schema (Gemini's OpenAPI dialect) for structured output. */
  responseSchema: Record<string, unknown>;
}

/**
 * Response schema for Gemini's structured output: mirrors outlineSchema
 * (types.ts) in the API's OpenAPI dialect. `propertyOrdering` stabilizes the
 * field order in the generated JSON (Google's recommendation).
 * NO minItems/maxItems: the endpoint rejects them with 400 (verified on
 * gemini-3.6-flash); the numeric limits are enforced by the Zod outlineSchema
 * and appear here only in the descriptions.
 */
export const OUTLINE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    chapters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Titolo del capitolo' },
          summary: { type: 'STRING', description: 'Riassunto del capitolo in 2–4 frasi' },
          beats: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Da 3 a 5 beat narrativi principali del capitolo, in ordine',
          },
        },
        required: ['title', 'summary', 'beats'],
        propertyOrdering: ['title', 'summary', 'beats'],
      },
    },
  },
  required: ['chapters'],
  propertyOrdering: ['chapters'],
};

const SYSTEM_INSTRUCTION = [
  'Sei un editor di narrativa esperto di struttura del romanzo.',
  'Dalla sinossi che ricevi costruisci la scaletta dei capitoli del libro.',
  'Per ogni capitolo proponi: un titolo evocativo ma sobrio, un riassunto di 2–4 frasi,',
  'e da 3 a 5 beat narrativi (gli snodi concreti della scena, in ordine).',
  'Decidi tu il numero di capitoli in base al respiro della storia.',
  'Scrivi tutto nella lingua del libro indicata.',
  'Se ti vengono elencati capitoli già scritti, NON riproporli e non riscriverli:',
  'la tua scaletta copre solo la parte di storia che manca, proseguendo con coerenza',
  'da dove i capitoli esistenti sono arrivati.',
  'Rispondi SOLO con il JSON conforme allo schema richiesto, senza testo attorno.',
].join('\n');

function writtenChaptersBlock(titles: string[]): string {
  if (titles.length === 0) return '';
  const list = titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
  return [
    '',
    'Capitoli GIÀ SCRITTI (in ordine — non riproporli, la scaletta prosegue dopo di loro):',
    list,
    '',
  ].join('\n');
}

/** Builds the prompt (pure function: the snapshot test locks it). */
export function buildOutlinePrompt(input: OutlinePromptInput): OutlinePrompt {
  const userText = [
    `Libro: «${input.book.title}»`,
    `Genere: ${input.book.genre === '' ? 'non indicato' : input.book.genre}`,
    `Lingua del libro: ${input.book.language === '' ? 'it' : input.book.language}`,
    writtenChaptersBlock(input.writtenChapterTitles),
    'Sinossi:',
    input.synopsis,
  ].join('\n');

  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    userText,
    responseSchema: OUTLINE_RESPONSE_SCHEMA,
  };
}
