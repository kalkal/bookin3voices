// Fumo OPZIONALE con chiamata VERA a Gemini: gira solo se
// GEMINI_API_KEY è nell'ambiente, altrimenti si salta (in CI non c'è chiave).
// Regola di commutazione: la chiave free si usa SOLO con testi
// fittizi — la sinossi qui sotto è inventata. Il modello di default è quello
// del tier FLASH: sulla chiave free il tier Pro ha quota 0 (verificato), il nome resta comunque da config/override.

import { GeminiProvider } from '../ai/provider/GeminiProvider';
import { ProviderModel } from '../ai/provider/ProviderModel';
import { sanitizeOutlineCandidate } from '../ai/generateOutline';
import { buildOutlinePrompt } from '../ai/outlinePrompt';
import { outlineSchema } from '../ai/types';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_SMOKE_MODEL ?? 'gemini-3.6-flash';

const maybeDescribe = API_KEY === undefined || API_KEY === '' ? describe.skip : describe;

const SINOSSI_FITTIZIA = [
  'Nora Ferrandi, cartografa in fuga da un divorzio, eredita dallo zio un faro dismesso',
  'su un’isola del Levante. Tra i registri del guardiano trova annotazioni cifrate su navi',
  'mai arrivate in porto. Indagando con l’aiuto di Tommaso, il barista del molo, scopre che',
  'l’isola nasconde un patto antico tra i pescatori e qualcosa che vive nella secca.',
].join(' ');

maybeDescribe('Gemini structured output (chiamata reale, sinossi fittizia)', () => {
  jest.setTimeout(120000);

  it('restituisce una scaletta conforme allo schema Zod', async () => {
    const model = new ProviderModel(
      () => new GeminiProvider({ model: () => MODEL, apiKey: () => API_KEY as string }),
      0.7,
    );
    const prompt = buildOutlinePrompt({
      synopsis: SINOSSI_FITTIZIA,
      book: { title: 'Il faro di Levante', genre: 'romanzo', language: 'it' },
      writtenChapterTitles: ['Il ritorno'],
    });

    const candidate = await model.generate(prompt);
    const parsed = outlineSchema.safeParse(sanitizeOutlineCandidate(candidate));
    if (!parsed.success) {
      throw new Error(`Outline non conforme: ${parsed.error.issues[0]?.message ?? '?'}`);
    }
    expect(parsed.data.chapters.length).toBeGreaterThanOrEqual(2);
    // nei log niente contenuti: solo numeri
    console.info(
      `Fumo Gemini ok: ${parsed.data.chapters.length} capitoli, modello ${model.modelName}`,
    );
  });
});
