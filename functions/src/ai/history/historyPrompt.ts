// History check prompts: two short calls, separate from the style/grammar/pacing
// refinement, because one long prompt with every rule made Nova skip the
// history part (golden run, 20/10). Rules are short, atomic and in English
// (MUST / DO NOT); only the notes for the author follow the book's language.
// Step 1 only LOCATES an explicitly named period, with an exact quote the code
// verifies; step 2 gets the period from the code and returns period details
// and anachronisms, each anchored to an exact quote. Prompts are code:
// versioned and locked by snapshot tests; replay the golden set on any change.

/** Bump on EVERY change to the text or the schemas of either step. */
export const HISTORY_PROMPT_VERSION = 3;

/** Closed list: anything else from the model is dropped by the code. */
export const HISTORY_CATEGORIES = [
  'technology',
  'objects',
  'money',
  'transport',
  'language',
  'clothing',
  'institutions',
] as const;

export const ANACHRONISM_SEVERITIES = ['impossible', 'unlikely'] as const;

export interface HistoryPrompt {
  systemInstruction: string;
  userText: string;
  /** Gemini's OpenAPI dialect, like the refine schema (the Bedrock provider converts it). */
  responseSchema: Record<string, unknown>;
}

function passageBlock(text: string, closing: string): string {
  return ['[PASSAGE START]', text, '[PASSAGE END]', '', closing].join('\n');
}

const DETECT_SYSTEM = [
  'You are a strict text locator. Your only job is to find out whether the passage',
  'EXPLICITLY names a historical period: a year, a decade, a century, a named era or a',
  'dated historical event.',
  '',
  '## Rules',
  '- "Explicitly named" means the passage literally contains it, e.g. "1943", "Napoli,',
  '  1943", "il Settecento", "in the 1880s", "dopo la caduta del Muro di Berlino".',
  '- DO NOT infer a period from style, objects, clothes, places or mood. DO NOT guess.',
  '- The present day, "a winter evening" or "years ago" are NOT a named period.',
  '- If nothing is named: period_named MUST be false, quote MUST be "" and period_label',
  '  MUST be "". This is the CORRECT answer for most passages.',
  '- quote MUST be copied character by character from the passage, as short as possible',
  '  (the place and the date only). Never paraphrase.',
  '- period_label: a short English label with place and time, e.g. "Naples, 1943".',
  '',
  '## Examples',
  'Passage: "Napoli, 1943. Il bucato era steso sul balcone." -> period_named=true,',
  '  quote="Napoli, 1943", period_label="Naples, 1943"',
  'Passage: "Il bucato asciugava mentre il sole calava." -> period_named=false,',
  '  quote="", period_label=""',
  'Passage: "She checked her phone at the station." -> period_named=false, quote="",',
  '  period_label=""',
].join('\n');

export const DETECT_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    period_named: {
      type: 'BOOLEAN',
      description: 'true only if a period is literally named in the passage',
    },
    quote: { type: 'STRING', description: 'exact text from the passage, or ""' },
    period_label: { type: 'STRING', description: 'short English label, or ""' },
  },
  required: ['period_named', 'quote', 'period_label'],
};

export function buildDetectPeriodPrompt(text: string): HistoryPrompt {
  return {
    systemInstruction: DETECT_SYSTEM,
    userText: passageBlock(text, 'Does the passage explicitly name a period? Use the tool.'),
    responseSchema: DETECT_SCHEMA,
  };
}

const LANGUAGE_NAMES: Record<string, string> = { it: 'Italian', en: 'English' };

function reportSystem(periodLabel: string, quote: string, language: string): string {
  const languageName = LANGUAGE_NAMES[language] ?? 'Italian';
  return [
    'You check one historical setting for a fiction writer. The period is GIVEN: do not',
    'question it.',
    `Period: ${periodLabel}. Evidence in the passage: "${quote}".`,
    '',
    '## Task',
    '1. anachronisms FIRST: read the passage sentence by sentence and list the named',
    '   technologies, devices, currencies, vehicles, garments or words that did not exist',
    '   yet, or were very unlikely, at that place and time.',
    '2. period_details: 1 to 2 concrete, well-established details of that place and time',
    '   that the author could ADD to an existing sentence of the passage.',
    '',
    '## Rules',
    '- If something in the passage did not exist yet, it MUST go in anachronisms, NEVER in',
    '  period_details. A period detail only adds words: it never removes or replaces any.',
    '- NEVER report ordinary things that have existed for centuries (a hat, a door, a',
    '  house, a bag, coffee, a street, a shop): they are not anachronisms.',
    '- Allowed categories ONLY: ' + HISTORY_CATEGORIES.join(', ') + '.',
    '- Every item MUST have a quote copied EXACTLY from the passage: anchor_quote (the',
    '  sentence the detail goes into) or trigger_quote (the anachronistic words, as few',
    '  as possible). No exact quote = do not report it.',
    '- period_details: rewrite = the anchor sentence with the detail added, in the',
    "  author's voice and in the passage's language.",
    '- anachronisms: replacement takes the place of the trigger_quote words ONLY, so the',
    '  sentence must read correctly with it: do not repeat the words around the quote.',
    '  Example: in "poured the milk from a plastic bottle", trigger_quote "plastic" ->',
    '  replacement "glass", NOT "a glass bottle".',
    '- severity="impossible" ONLY if the thing certainly did not exist yet; if it existed',
    '  but was rare or unusual there, severity="unlikely".',
    '- DO NOT report things that existed and were common then. When in doubt, DO NOT',
    '  report. An empty anachronisms list is a good answer.',
    '- Use only facts that are widely known about that place and time. If you are not',
    '  sure a fact is true THERE and THEN, leave it out: fewer details are better than a',
    '  wrong one. DO NOT cite books, authors, archives or exact dates.',
    `- Write note_for_author and rewrite/replacement in ${languageName}. note_for_author`,
    '  is one short, cautious sentence ("usually", "probably").',
    '- At most 3 anachronisms and 2 period_details.',
    '',
    '## Example (period: Rome, 1950)',
    'Passage: "Rome, 1950. He wore a grey hat and sent her a text message from the bar."',
    '-> anachronisms: [{ trigger_quote: "sent her a text message", category: "technology",',
    '   severity: "impossible", replacement: "left her a note" }]. The grey hat and the bar',
    '   are NOT anachronisms.',
  ].join('\n');
}

const CATEGORY_DESCRIPTION = `one of: ${HISTORY_CATEGORIES.join(', ')}`;

export const REPORT_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    anachronisms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          trigger_quote: { type: 'STRING', description: 'exact words from the passage' },
          category: { type: 'STRING', description: CATEGORY_DESCRIPTION },
          severity: { type: 'STRING', description: 'impossible or unlikely' },
          replacement: { type: 'STRING', description: 'period-correct alternative' },
          note_for_author: { type: 'STRING', description: 'one short cautious sentence' },
        },
        required: ['trigger_quote', 'category', 'severity', 'replacement', 'note_for_author'],
      },
    },
    period_details: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          anchor_quote: { type: 'STRING', description: 'exact sentence from the passage' },
          category: { type: 'STRING', description: CATEGORY_DESCRIPTION },
          rewrite: { type: 'STRING', description: 'the anchor sentence with the detail added' },
          note_for_author: { type: 'STRING', description: 'one short cautious sentence' },
        },
        required: ['anchor_quote', 'category', 'rewrite', 'note_for_author'],
      },
    },
  },
  required: ['anachronisms', 'period_details'],
};

export function buildReportHistoryPrompt(args: {
  text: string;
  periodLabel: string;
  quote: string;
  language: string;
}): HistoryPrompt {
  return {
    systemInstruction: reportSystem(args.periodLabel, args.quote, args.language),
    userText: passageBlock(
      args.text,
      'List the period details and the anachronisms for the given period. Use the tool.',
    ),
    responseSchema: REPORT_SCHEMA,
  };
}
