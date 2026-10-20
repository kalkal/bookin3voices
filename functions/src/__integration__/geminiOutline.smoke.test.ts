// OPTIONAL smoke test with a REAL Gemini call: runs only if GEMINI_API_KEY
// is in the environment, otherwise it is skipped (CI has no key).
// Switching rule: the free key is used ONLY with fictitious texts
// — the synopsis below is made up. The default model is the FLASH tier:
// on the free key the Pro tier has quota 0 (verified); the name still comes from config/override.

import { GeminiProvider } from '../ai/provider/GeminiProvider';
import { ProviderModel } from '../ai/provider/ProviderModel';
import { sanitizeOutlineCandidate } from '../ai/generateOutline';
import { buildOutlinePrompt } from '../ai/outlinePrompt';
import { outlineSchema } from '../ai/types';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_SMOKE_MODEL ?? 'gemini-3.6-flash';

const maybeDescribe = API_KEY === undefined || API_KEY === '' ? describe.skip : describe;

const SINOSSI_FITTIZIA = [
  'Viola, apicoltrice, rileva le arnie abbandonate di un apicoltore scomparso nella valle',
  'di Rocca Bassa. Nei quaderni del vecchio mulino trova annotazioni su sciami mai tornati',
  'alle arnie. Indagando con l’aiuto di Ivan, il guardiaparco, scopre che la valle',
  'nasconde un patto antico tra il paese e qualcosa che vive in una gola chiusa da una frana.',
].join(' ');

maybeDescribe('Gemini structured output (real call, fictitious synopsis)', () => {
  jest.setTimeout(120000);

  it('returns an outline that conforms to the Zod schema', async () => {
    const model = new ProviderModel(
      () => new GeminiProvider({ model: () => MODEL, apiKey: () => API_KEY as string }),
      0.7,
    );
    const prompt = buildOutlinePrompt({
      synopsis: SINOSSI_FITTIZIA,
      book: { title: 'Il mulino di Rocca Bassa', genre: 'romanzo', language: 'it' },
      writtenChapterTitles: ['Il ritorno'],
    });

    const candidate = await model.generate(prompt);
    const parsed = outlineSchema.safeParse(sanitizeOutlineCandidate(candidate));
    if (!parsed.success) {
      throw new Error(`Outline does not conform: ${parsed.error.issues[0]?.message ?? '?'}`);
    }
    expect(parsed.data.chapters.length).toBeGreaterThanOrEqual(2);
    // no content in logs: numbers only
    console.info(
      `Gemini smoke ok: ${parsed.data.chapters.length} chapters, model ${model.modelName}`,
    );
  });
});
