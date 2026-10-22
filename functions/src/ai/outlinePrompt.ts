// Outline generation prompt. Prompts are CODE: versioned
// (OUTLINE_PROMPT_VERSION) and covered by snapshot tests; a refactor must not
// change them silently, and an intentional change updates the version and the
// snapshot together.
//
// Rules built into the prompt: chapters already written are untouchable
// context; the model does NOT propose them again, and the outline continues
// from where the book has got to. The real additive merge still belongs to the
// app: the prompt is the first line of defense, not the guarantee.
//
// The book's writing style (Suspense / Mystery / Storico, styles.ts) shapes the
// structure: the same synopsis gives a different outline for a whodunit and for
// a historical novel.

import { resolveStyleId, STYLES, type StyleId } from './styles';

/** Prompt version: bump on EVERY change to the text or the schema. */
export const OUTLINE_PROMPT_VERSION = 2;

export interface OutlinePromptInput {
  synopsis: string;
  book: {
    title: string;
    genre: string;
    language: string;
  };
  /** The book's writing style: shapes the structure of the outline. */
  style: StyleId;
  /** Titles of chapters with text (non-empty rawText), in order: context only. */
  writtenChapterTitles: string[];
}

/** Prompt ready for the model: instructions, user text and response schema. */
export interface OutlinePrompt {
  systemInstruction: string;
  userText: string;
  /** JSON Schema (OpenAPI dialect, upper-case type names) for structured output. */
  responseSchema: Record<string, unknown>;
}

/**
 * Response schema for the structured output: mirrors outlineSchema (types.ts)
 * in the OpenAPI dialect; the Bedrock provider turns it into plain JSON Schema
 * (provider/schema.ts drops `propertyOrdering`). NO minItems/maxItems: the
 * numeric limits are enforced by the Zod outlineSchema and appear here only in
 * the descriptions.
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
  'Costruisci la scaletta secondo lo stile del libro indicato: ritmo, struttura e',
  'finali di capitolo devono servire quel genere, non uno generico.',
  'Scrivi tutto nella lingua del libro indicata.',
  'Se ti vengono elencati capitoli già scritti, NON riproporli e non riscriverli:',
  'la tua scaletta copre solo la parte di storia che manca, proseguendo con coerenza',
  'da dove i capitoli esistenti sono arrivati.',
  'Rispondi SOLO con il JSON conforme allo schema richiesto, senza testo attorno.',
].join('\n');

/** What each style asks of the STRUCTURE of the book (not of the prose). */
const STYLE_STRUCTURE: Record<StyleId, string> = {
  suspense:
    'la minaccia si sente prima di vederla: crescendo lento che accelera, ogni capitolo chiude su un’inquietudine nuova, la rivelazione arriva tardi.',
  mystery:
    'una domanda centrale (chi, come, perché) aperta presto; indizi distribuiti con fair play tra i capitoli, false piste, e un finale che riordina gli indizi già visti.',
  historical:
    'un’epoca precisa e coerente fin dal primo capitolo; la grande storia preme sulle scelte dei personaggi senza diventare lezione; ogni capitolo ancorato a un momento e a un luogo del tempo, i finali legano il destino personale agli eventi.',
};

/**
 * The style of an outline: the one the app sends (the user may have just
 * changed it), else the one saved on the book, else the default.
 */
export function outlineStyleOf(requested: StyleId | undefined, bookStyle: unknown): StyleId {
  return requested ?? resolveStyleId(bookStyle);
}

function styleBlock(style: StyleId): string {
  const info = STYLES.find((candidate) => candidate.id === style) ?? STYLES[0];
  return [
    `Stile del libro: ${info?.label.it ?? style} — ${info?.summary.it ?? ''}`,
    `Struttura richiesta dallo stile: ${STYLE_STRUCTURE[style]}`,
  ].join('\n');
}

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
    styleBlock(input.style),
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
