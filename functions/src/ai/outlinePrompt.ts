// Prompt della generazione outline. I prompt sono CODICE (
//): versionati (OUTLINE_PROMPT_VERSION) e coperti da snapshot test — un
// refactor non deve cambiarli silenziosamente, una modifica voluta aggiorna
// versione e snapshot insieme.
//
// Regole incorporate nel prompt: i capitoli già scritti sono
// contesto intoccabile — il modello NON li ripropone, la scaletta prosegue
// da dove il libro è arrivato. Il merge additivo vero resta comunque all'app:
// il prompt è la prima linea, non la garanzia.

/** Versione del prompt: da incrementare a OGNI modifica del testo o dello schema. */
export const OUTLINE_PROMPT_VERSION = 1;

export interface OutlinePromptInput {
  synopsis: string;
  book: {
    title: string;
    genre: string;
    language: string;
  };
  /** Titoli dei capitoli con testo (rawText non vuoto), in ordine: solo contesto. */
  writtenChapterTitles: string[];
}

/** Prompt pronto per il modello: istruzioni, testo utente e schema di risposta. */
export interface OutlinePrompt {
  systemInstruction: string;
  userText: string;
  /** JSON Schema (dialetto OpenAPI di Gemini) per lo structured output. */
  responseSchema: Record<string, unknown>;
}

/**
 * Schema di risposta per lo structured output di Gemini: rispecchia
 * outlineSchema (types.ts) nel dialetto OpenAPI dell'API. `propertyOrdering`
 * stabilizza l'ordine dei campi nel JSON generato (raccomandazione Google).
 * NIENTE minItems/maxItems: l'endpoint li rifiuta con 400 (verificato
 * su gemini-3.6-flash) — i limiti numerici li fa rispettare lo
 * Zod di outlineSchema, qui restano solo nelle description.
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

/** Costruisce il prompt (funzione pura: lo snapshot test la blocca). */
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
