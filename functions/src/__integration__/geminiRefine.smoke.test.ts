// OPTIONAL refine smoke test with a REAL Gemini call.
// Runs only if GEMINI_API_KEY is in the environment (CI has none → skip).
// Fictitious text ONLY: the free key is allowed solely with sample passages
// (switching rule). Logs contain counts only, never content.

import { GeminiRefineModel } from '../ai/GeminiRefineModel';
import { normalizeSuggestions } from '../ai/normalizeSuggestions';
import { buildRefinePrompt } from '../ai/refinePrompt';
import { modelOutputSchema } from '../ai/refineTypes';
import { loadStyleProfileContent } from '../ai/styleProfileContent';
import { textHash } from '../ai/textHash';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_SMOKE_MODEL ?? 'gemini-3.5-flash';

const maybeDescribe = API_KEY === undefined || API_KEY === '' ? describe.skip : describe;

// FICTITIOUS passage with planted defects (adverb, filter word, redundancy)
// and a colloquial line of dialogue that must not be touched.
const TESTO_FITTIZIO = [
  'Quella mattina Riccardo aprì lentamente la saracinesca del bar e vide che',
  'la macchina del caffè era rimasta accesa tutta la notte. Annuì con la testa',
  'e uscì fuori sul marciapiede. «Boh, sarà stato er solito distratto» disse',
  'la signora del chiosco dei giornali.',
].join(' ');

maybeDescribe('Gemini refine smoke (real call, fictitious passage)', () => {
  it('produces suggestions that conform to the schema and can be anchored to the text', async () => {
    const profile = loadStyleProfileContent('suspense');
    const model = new GeminiRefineModel({
      model: () => MODEL,
      apiKey: () => API_KEY as string,
    });
    const prompt = buildRefinePrompt({
      styleBible: profile.styleBible,
      fewShots: profile.fewShots,
      book: { title: 'Prova fumo', genre: '', language: 'it', synopsis: '' },
      chapter: { title: 'Capitolo di prova', outline: null },
      text: TESTO_FITTIZIO,
    });

    const candidate = await model.generate(prompt);
    const output = modelOutputSchema.parse(candidate);
    const { suggestions, discarded } = normalizeSuggestions(
      output,
      TESTO_FITTIZIO,
      textHash(TESTO_FITTIZIO),
      'smoke-1',
    );

    console.log(
      `refine smoke on ${MODEL}: ${output.suggestions.length} from the model, ${suggestions.length} anchored, ${discarded} discarded`,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    // the colloquial line is left alone (rule: inside quotation marks)
    for (const sug of suggestions) {
      expect(sug.original).not.toContain('er solito distratto');
    }
  }, 120_000);
});
