// Callable `refineTitle(bookId, chapterId, title, requestId)`: «Rifinisci il
// titolo». The chapter title lives in the chapter document, not in rawText, so
// it cannot go through refineChapter's text-anchored suggestions: this small
// path asks the model for up to 3 alternative titles, with the book and a
// bounded excerpt of the chapter as context. Nothing is stored: the app shows
// the proposals and saves the one the user picks (updateChapter).

import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { bookForRefineSchema, chapterForRefineSchema, type RefineModel } from './refineTypes';
import { enforceUsageLimit, type UsageAction, type UsageLimit } from '../usage/rateLimit';

export const refineTitleInputSchema = z.object({
  bookId: z.string().min(1),
  chapterId: z.string().min(1),
  /** The title as the user sees it (may be empty: then the model proposes one). */
  title: z.string().max(200),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});
export type RefineTitleInput = z.infer<typeof refineTitleInputSchema>;

export interface RefineTitleResponse {
  requestId: string;
  model: string;
  /** 0–3 alternative titles, cleaned; empty = nothing better to propose. */
  proposals: string[];
}

export interface TitleContext {
  book: { title: string; genre: string; language: string; synopsis: string };
  chapter: { title: string; rawText: string };
}

/** Longest chapter excerpt sent as context (the title needs the gist, not every word). */
export const TITLE_CONTEXT_CHARS = 4000;
const MAX_TITLE_CHARS = 80;
const MAX_PROPOSALS = 3;

const titleOutputSchema = z.object({
  proposals: z.array(z.string()),
  rationale: z.string().optional(),
});

const TITLE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    proposals: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: ['proposals'],
};

export function buildTitlePrompt(
  context: TitleContext,
  title: string,
): { systemInstruction: string; userText: string; responseSchema: Record<string, unknown> } {
  const excerpt = context.chapter.rawText.slice(0, TITLE_CONTEXT_CHARS);
  const systemInstruction = [
    'Sei un editor di narrativa. Proponi titoli di capitolo brevi, concreti, nella lingua del libro.',
    'Il titolo deve nascere da ciò che accade nel capitolo: niente spoiler del finale, niente parole inventate.',
    `Restituisci da 1 a ${MAX_PROPOSALS} proposte diverse dal titolo attuale, ciascuna di al massimo ${MAX_TITLE_CHARS} caratteri, senza virgolette.`,
  ].join('\n');
  const userText = [
    `Libro: «${context.book.title === '' ? 'senza titolo' : context.book.title}»`,
    `Genere: ${context.book.genre === '' ? 'non indicato' : context.book.genre}`,
    `Lingua del libro: ${context.book.language === '' ? 'it' : context.book.language}`,
    ...(context.book.synopsis === '' ? [] : [`Sinossi: ${context.book.synopsis}`]),
    `Titolo attuale del capitolo: «${title === '' ? 'nessuno' : title}»`,
    '',
    'Inizio del capitolo (solo contesto):',
    '<<<',
    excerpt,
    '>>>',
  ].join('\n');
  return { systemInstruction, userText, responseSchema: TITLE_RESPONSE_SCHEMA };
}

/** Trim, unquote, drop empty / unchanged / multi-line / too long / duplicate; at most 3. */
export function normalizeTitleProposals(raw: readonly string[], current: string): string[] {
  const seen = new Set([current.trim().toLowerCase()]);
  const result: string[] = [];
  for (const candidate of raw) {
    const title = candidate
      .trim()
      .replace(/^["«“'‘]+|["»”'’]+$/g, '')
      .trim();
    const key = title.toLowerCase();
    if (title === '' || title.includes('\n') || title.length > MAX_TITLE_CHARS || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(title);
    if (result.length === MAX_PROPOSALS) break;
  }
  return result;
}

export interface RefineTitleDeps {
  loadContext: (uid: string, input: RefineTitleInput) => Promise<TitleContext>;
  enforceLimit: (uid: string) => Promise<void>;
  model: RefineModel;
  log: (message: string, data: object) => void;
}

export async function runRefineTitle(
  deps: RefineTitleDeps,
  uid: string,
  input: RefineTitleInput,
): Promise<RefineTitleResponse> {
  const context = await deps.loadContext(uid, input);
  await deps.enforceLimit(uid);
  const prompt = buildTitlePrompt(context, input.title);
  // one retry on a malformed answer, as refineChapter does
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = titleOutputSchema.safeParse(await deps.model.generate(prompt));
    if (!parsed.success) continue;
    const proposals = normalizeTitleProposals(parsed.data.proposals, input.title);
    deps.log('refineTitle: proposals', {
      requestId: input.requestId,
      model: deps.model.modelName,
      proposals: proposals.length,
      dropped: parsed.data.proposals.length - proposals.length,
    });
    return { requestId: input.requestId, model: deps.model.modelName, proposals };
  }
  throw new HttpsError('internal', 'The model did not return valid title proposals. Try again.');
}

async function loadTitleContext(
  db: Firestore,
  uid: string,
  input: RefineTitleInput,
): Promise<TitleContext> {
  const bookRef = db.doc(`users/${uid}/books/${input.bookId}`);
  const [bookSnap, chapterSnap] = await Promise.all([
    bookRef.get(),
    bookRef.collection('chapters').doc(input.chapterId).get(),
  ]);
  if (!bookSnap.exists) throw new HttpsError('not-found', 'Book not found.');
  if (!chapterSnap.exists) throw new HttpsError('not-found', 'Chapter not found.');
  const book = bookForRefineSchema.parse(bookSnap.data() ?? {});
  const chapter = chapterForRefineSchema.parse(chapterSnap.data() ?? {});
  return {
    book: {
      title: book.title,
      genre: book.genre,
      language: book.language,
      synopsis: book.synopsis,
    },
    chapter: { title: chapter.title, rawText: chapter.rawText },
  };
}

/** Callable handler: auth + input validation, then runRefineTitle. */
export function createRefineTitleHandler(args: {
  db: Firestore;
  model: RefineModel;
  usageLimits?: Record<UsageAction, UsageLimit>;
}): (request: CallableRequest<unknown>) => Promise<RefineTitleResponse> {
  return async (request) => {
    const uid = request.auth?.uid;
    if (uid === undefined) throw new HttpsError('unauthenticated', 'Sign-in required.');
    const parsed = refineTitleInputSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Expected { bookId, chapterId, title, requestId }.');
    }
    return runRefineTitle(
      {
        loadContext: (u, input) => loadTitleContext(args.db, u, input),
        enforceLimit: (u) =>
          enforceUsageLimit({
            db: args.db,
            uid: u,
            action: 'refineTitle',
            limits: args.usageLimits,
          }),
        model: args.model,
        log: (message, data) => logger.info(message, data),
      },
      uid,
      parsed.data,
    );
  };
}
