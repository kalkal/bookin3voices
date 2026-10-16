// Fumo OPZIONALE della rifinitura con chiamata VERA a Gemini.
// Gira solo se GEMINI_API_KEY è nell'ambiente (in CI non c'è → skip).
// SOLO testo fittizio: la chiave free è ammessa unicamente con brani di prova
// (regola di commutazione). Nei log solo conteggi, mai contenuti.

import { GeminiRefineModel } from '../ai/GeminiRefineModel';
import { normalizeSuggestions } from '../ai/normalizeSuggestions';
import { buildRefinePrompt } from '../ai/refinePrompt';
import { modelOutputSchema } from '../ai/refineTypes';
import { loadStyleProfileContent } from '../ai/styleProfileContent';
import { textHash } from '../ai/textHash';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_SMOKE_MODEL ?? 'gemini-3.5-flash';

const maybeDescribe = API_KEY === undefined || API_KEY === '' ? describe.skip : describe;

// Brano FITTIZIO con difetti piantati (avverbio, filtro, ridondanza) e una
// battuta colloquiale da non toccare.
const TESTO_FITTIZIO = [
  'Quella mattina Riccardo aprì lentamente la saracinesca del bar e vide che',
  'la macchina del caffè era rimasta accesa tutta la notte. Annuì con la testa',
  'e uscì fuori sul marciapiede. «Boh, sarà stato er solito distratto» disse',
  'la signora del chiosco dei giornali.',
].join(' ');

maybeDescribe('fumo Gemini refine (chiamata vera, brano fittizio)', () => {
  it('produce suggerimenti conformi allo schema e ancorabili al testo', async () => {
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
      `fumo refine su ${MODEL}: ${output.suggestions.length} dal modello, ${suggestions.length} ancorati, ${discarded} scartati`,
    );
    expect(suggestions.length).toBeGreaterThan(0);
    // la battuta colloquiale non si tocca (Regola «dentro le virgolette»)
    for (const sug of suggestions) {
      expect(sug.original).not.toContain('er solito distratto');
    }
  }, 120_000);
});
