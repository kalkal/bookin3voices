// Golden-set runner — IL freno di regressione dei prompt.
//
// Esegue TUTTI i brani di content/style-profiles/suspense/golden-set/
// contro il prompt corrente (buildRefinePrompt = Style Bible + few-shot +
// regole di formato) e verifica MECCANICAMENTE ciò che è verificabile
// (quality priorities):
//   - formato valido (Zod) e original localizzabile una sola volta nel brano;
//   - una sola proposta per i suggerimenti grammar;
//   - densità dentro i limiti del brano (checks.json) e tetto assoluto 30;
//   - zero span che toccano le zone «NON DEVE» (checks.json): un suggerimento
//     che attraversa una zona protetta è sano solo se OGNI proposta riporta
//     il testo protetto INVARIATO;
//   - copertura dei «DEVE» (riportata come diagnostica: il giudizio di
//     qualità resta umano, il runner conta).
//
// Va rigiocato a OGNI modifica di Style Bible / few-shot / prompt / modello.
// Il giudizio finale sulla qualità resta umano: il runner blocca solo
// le regressioni meccaniche.
//
// Uso:  npm run golden -- [--model X] [--fallback Y] [--only 04] [--out report.md]
// Chiave: env GEMINI_API_KEY. SOLO brani fittizi col tier free.
// La chiave non viene mai stampata.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { GeminiRefineModel, isRetryableGeminiError } from '../ai/GeminiRefineModel';
import { normalizeSuggestions, MAX_SUGGESTIONS } from '../ai/normalizeSuggestions';
import { buildRefinePrompt } from '../ai/refinePrompt';
import { modelOutputSchema, type ModelOutput, type Suggestion } from '../ai/refineTypes';
import { loadStyleProfileContent } from '../ai/styleProfileContent';
import { textHash } from '../ai/textHash';

// ---------- checks.json ----------

interface ProtectedRegionSpec {
  /** Citazione dal brano; «…» separa i frammenti di una zona estesa. */
  quote: string;
  /** Categorie ammesse a intersecare la zona (es. grammar sul paragrafo-fiume). */
  allow?: string[];
  /** 'fail' (default) fa fallire il run; 'warn' segnala per il giudizio umano. */
  level?: 'fail' | 'warn';
  note?: string;
}

interface ExpectedSpec {
  label: string;
  quote: string;
}

interface BranoChecks {
  /** [min, max] della «Densità attesa» del brano: sopra il max è FAIL. */
  expectedRange: [number, number];
  protected: ProtectedRegionSpec[];
  expected: ExpectedSpec[];
}

type ChecksFile = Record<string, BranoChecks>;

interface Region {
  from: number;
  to: number;
}

/** Localizza una citazione (con frammenti «…») nel brano. Errore se non c'è:
 *  vuol dire che checks.json e brano sono andati fuori sincrono. */
function locateRegions(text: string, quote: string, file: string): Region[] {
  const fragments = quote
    .split('…')
    .map((f) => f.trim())
    .filter((f) => f !== '');
  if (fragments.length === 0) throw new Error(`${file}: citazione vuota in checks.json`);

  if (fragments.length === 1) {
    const fragment = fragments[0] as string;
    const regions: Region[] = [];
    let index = text.indexOf(fragment);
    while (index !== -1) {
      regions.push({ from: index, to: index + fragment.length });
      index = text.indexOf(fragment, index + 1);
    }
    if (regions.length === 0) {
      throw new Error(`${file}: citazione non trovata nel brano: «${fragment.slice(0, 60)}»`);
    }
    return regions;
  }

  const first = fragments[0] as string;
  const from = text.indexOf(first);
  if (from === -1) throw new Error(`${file}: frammento non trovato: «${first.slice(0, 60)}»`);
  let cursor = from + first.length;
  for (const fragment of fragments.slice(1)) {
    const at = text.indexOf(fragment, cursor);
    if (at === -1)
      throw new Error(
        `${file}: frammento non trovato dopo il precedente: «${fragment.slice(0, 60)}»`,
      );
    cursor = at + fragment.length;
  }
  return [{ from, to: cursor }];
}

// ---------- estrazione brano ----------

function extractBrano(markdown: string, file: string): string {
  const match = /## Brano\s*\n([\s\S]*?)\n## /.exec(markdown);
  if (match === null) throw new Error(`${file}: sezione «## Brano» non trovata`);
  // I .md vanno a capo a ~90 colonne per leggibilità: dentro un paragrafo gli
  // a-capo singoli sono formattazione, non testo. Si srotolano (come farebbe
  // la dettatura), i paragrafi (riga vuota) restano.
  return (match[1] as string)
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .join('\n\n');
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length;
}

// ---------- chiave API ----------

function resolveApiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  throw new Error('Set the GEMINI_API_KEY environment variable.');
}

// ---------- verifica di un brano ----------

interface Violation {
  level: 'fail' | 'warn';
  message: string;
}

interface BranoReport {
  file: string;
  words: number;
  model: string;
  expectedRange: [number, number];
  rawCount: number;
  count: number;
  discarded: number;
  grammarMultiProposal: number;
  densityOk: boolean;
  violations: Violation[];
  coverage: { covered: string[]; missed: string[] };
  suggestions: Suggestion[];
  failed: boolean;
}

function checkBrano(
  file: string,
  text: string,
  checks: BranoChecks,
  raw: ModelOutput,
  modelName: string,
): BranoReport {
  const hash = textHash(text);
  const words = countWords(text);
  const violations: Violation[] = [];

  // grammar con più proposte: violazione di formato PRIMA della normalizzazione
  const grammarMultiProposal = raw.suggestions.filter(
    (s) => s.kind === 'grammar' && s.proposals.length > 1,
  ).length;
  if (grammarMultiProposal > 0) {
    violations.push({
      level: 'fail',
      message: `${grammarMultiProposal} suggerimento/i grammar con più di una proposta`,
    });
  }

  const { suggestions, discarded } = normalizeSuggestions(raw, text, hash, 'golden');
  if (discarded > 0) {
    violations.push({
      level: 'warn',
      message: `${discarded} suggerimento/i scartato/i (original assente/ambiguo o proposte vuote)`,
    });
  }

  // densità: FAIL oltre il tetto meccanico (il maggiore tra il massimo del
  // brano e 1 ogni ~50 parole della Style Bible, mai oltre 30); WARN se fuori
  // dalla griglia umana del brano.
  const [minExpected, maxExpected] = checks.expectedRange;
  const failThreshold = Math.min(Math.max(maxExpected, Math.ceil(words / 50)), MAX_SUGGESTIONS);
  const densityOk = suggestions.length <= failThreshold;
  if (!densityOk) {
    violations.push({
      level: 'fail',
      message: `densità fuori tetto: ${suggestions.length} suggerimenti (tetto ${failThreshold})`,
    });
  } else if (suggestions.length > maxExpected) {
    violations.push({
      level: 'warn',
      message: `densità sopra la griglia del brano: ${suggestions.length} > ${maxExpected}`,
    });
  } else if (suggestions.length < minExpected) {
    violations.push({
      level: 'warn',
      message: `densità sotto l'attesa: ${suggestions.length} < ${minExpected}`,
    });
  }

  // zone protette (NON DEVE)
  for (const spec of checks.protected) {
    const level = spec.level ?? 'fail';
    const allow = spec.allow ?? [];
    for (const region of locateRegions(text, spec.quote, file)) {
      for (const sug of suggestions) {
        const overlapFrom = Math.max(sug.span.from, region.from);
        const overlapTo = Math.min(sug.span.to, region.to);
        if (overlapFrom >= overlapTo) continue;
        const overlapText = text.slice(overlapFrom, overlapTo);
        const preservesRegion = sug.proposals.every((p) => p.includes(overlapText));
        if (preservesRegion) continue;
        if (allow.includes(sug.kind)) continue;
        violations.push({
          level,
          message:
            `zona protetta toccata («${spec.quote.slice(0, 50)}»): ` +
            `[${sug.kind}] «${sug.original.slice(0, 60)}» → «${(sug.proposals[0] ?? '').slice(0, 60)}»` +
            (spec.note === undefined ? '' : ` — ${spec.note}`),
        });
      }
    }
  }

  // copertura DEVE (diagnostica)
  const covered: string[] = [];
  const missed: string[] = [];
  for (const expected of checks.expected) {
    const regions = locateRegions(text, expected.quote, file);
    const hit = suggestions.some((sug) =>
      regions.some((r) => Math.max(sug.span.from, r.from) < Math.min(sug.span.to, r.to)),
    );
    (hit ? covered : missed).push(expected.label);
  }
  if (missed.length > 0) {
    violations.push({ level: 'warn', message: `DEVE non coperti: ${missed.join('; ')}` });
  }

  return {
    file,
    words,
    model: modelName,
    expectedRange: checks.expectedRange,
    rawCount: raw.suggestions.length,
    count: suggestions.length,
    discarded,
    grammarMultiProposal,
    densityOk,
    violations,
    coverage: { covered, missed },
    suggestions,
    failed: violations.some((v) => v.level === 'fail'),
  };
}

// ---------- chiamata modello con retry e riserva ----------

async function generateWithRetry(
  models: GeminiRefineModel[],
  prompt: ReturnType<typeof buildRefinePrompt>,
): Promise<{ output: ModelOutput; modelName: string }> {
  let lastError: unknown;
  const attempts: GeminiRefineModel[] = [models[0] as GeminiRefineModel, ...models];
  for (const model of attempts) {
    try {
      const raw = await model.generate(prompt);
      return { output: modelOutputSchema.parse(raw), modelName: model.modelName };
    } catch (error) {
      lastError = error;
      const label = error instanceof Error ? error.message.slice(0, 160) : String(error);
      console.warn(`  tentativo fallito su ${model.modelName}: ${label}`);
      if (
        !isRetryableGeminiError(error) &&
        !(error instanceof Error && error.name === 'ZodError')
      ) {
        // errori non ritentabili (es. 400): inutile insistere sullo stesso input
        if (error instanceof SyntaxError) continue; // JSON rotto: riprova
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------- report ----------

function renderReport(reports: BranoReport[], startedAt: Date): string {
  const lines: string[] = [];
  const failed = reports.filter((r) => r.failed);
  lines.push(`# Golden set — report del ${startedAt.toISOString().slice(0, 16).replace('T', ' ')}`);
  lines.push('');
  lines.push(
    `Esito: ${failed.length === 0 ? 'VERDE ✅' : `ROSSO ❌ (${failed.length} brani con FAIL)`}`,
  );
  lines.push('');
  lines.push('| Brano | Parole | Modello | Sugg. | Range atteso | DEVE coperti | FAIL | WARN |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    const fails = r.violations.filter((v) => v.level === 'fail').length;
    const warns = r.violations.filter((v) => v.level === 'warn').length;
    const total = r.coverage.covered.length + r.coverage.missed.length;
    lines.push(
      `| ${r.file} | ${r.words} | ${r.model} | ${r.count} | ${r.expectedRange[0]}–${r.expectedRange[1]} | ${r.coverage.covered.length}/${total} | ${fails} | ${warns} |`,
    );
  }
  for (const r of reports) {
    lines.push('', `## ${r.file} — ${r.failed ? 'FAIL ❌' : 'ok ✅'}`);
    lines.push(
      `${r.count} suggerimenti tenuti (${r.rawCount} dal modello, ${r.discarded} scartati) su ${r.words} parole.`,
    );
    for (const v of r.violations) lines.push(`- **${v.level.toUpperCase()}** ${v.message}`);
    if (r.coverage.missed.length === 0 && r.violations.length === 0) lines.push('- nessun rilievo');
    lines.push('', '<details><summary>Suggerimenti</summary>', '');
    for (const s of r.suggestions) {
      lines.push(
        `- [${s.kind}] «${s.original}» → ${s.proposals.map((p) => `«${p}»`).join(' / ')} — ${s.rationale}`,
      );
    }
    lines.push('', '</details>');
  }
  return lines.join('\n');
}

// ---------- main ----------

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const startedAt = new Date();
  // Default ALLINEATI alla produzione (functions/.env, ai/models.ts): senza
  // argomenti il runner deve giocare il modello DAVVERO deployato, altrimenti
  // il freno di regressione darebbe un verde su un modello diverso da quello in
  // esercizio. Stessi nomi di env var della config (GEMINI_MODEL_REFINE*).
  const primaryName = argValue('model') ?? process.env.GEMINI_MODEL_REFINE ?? 'gemini-3.5-flash';
  const fallbackName =
    argValue('fallback') ?? process.env.GEMINI_MODEL_REFINE_FALLBACK ?? 'gemini-3.6-flash';
  const only = argValue('only');
  const out = argValue('out');
  const dry = process.argv.includes('--dry');

  const apiKey = dry ? 'dry-run' : resolveApiKey();
  const primary = new GeminiRefineModel({ model: () => primaryName, apiKey: () => apiKey });
  const models = [primary];
  if (fallbackName !== '' && fallbackName !== primaryName) {
    models.push(new GeminiRefineModel({ model: () => fallbackName, apiKey: () => apiKey }));
  }

  const goldenDir = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'content',
    'style-profiles',
    'suspense',
    'golden-set',
  );
  const checksPath = path.join(goldenDir, 'checks.json');
  const checksFile = JSON.parse(readFileSync(checksPath, 'utf8')) as ChecksFile;
  const profile = loadStyleProfileContent('suspense');

  const files = readdirSync(goldenDir)
    .filter((f) => /^\d\d-.*\.md$/.test(f))
    .filter((f) => (only === undefined ? true : f.includes(only)))
    .sort();
  if (files.length === 0) throw new Error('nessun brano selezionato');

  const reports: BranoReport[] = [];
  for (const file of files) {
    const checks = checksFile[file];
    if (checks === undefined) throw new Error(`${file}: manca la voce in checks.json`);
    const markdown = readFileSync(path.join(goldenDir, file), 'utf8');
    const text = extractBrano(markdown, file);

    console.log(`\n▶ ${file} (${countWords(text)} parole)…`);
    if (dry) {
      // solo validazione checks ↔ brano (locateRegions esplode se disallineati)
      for (const spec of checks.protected) locateRegions(text, spec.quote, file);
      for (const spec of checks.expected) locateRegions(text, spec.quote, file);
      console.log('  checks allineati al brano ✓');
      continue;
    }
    const prompt = buildRefinePrompt({
      styleBible: profile.styleBible,
      fewShots: profile.fewShots,
      book: { title: 'Golden set', genre: '', language: 'it', synopsis: '' },
      chapter: { title: file.replace(/\.md$/, ''), outline: null },
      text,
    });
    const { output, modelName } = await generateWithRetry(models, prompt);
    const report = checkBrano(file, text, checks, output, modelName);
    reports.push(report);
    const fails = report.violations.filter((v) => v.level === 'fail');
    console.log(
      `  ${report.count} suggerimenti (${report.discarded} scartati), DEVE ${report.coverage.covered.length}/${report.coverage.covered.length + report.coverage.missed.length}, ${fails.length} FAIL`,
    );
    for (const v of report.violations) console.log(`  ${v.level.toUpperCase()}: ${v.message}`);
  }

  if (dry) {
    console.log('\nDry run: checks.json e brani allineati.');
    return;
  }

  const rendered = renderReport(reports, startedAt);
  if (out !== undefined) {
    writeFileSync(out, rendered, 'utf8');
    console.log(`\nReport scritto in ${out}`);
  }
  console.log(`\n${rendered}`);

  if (reports.some((r) => r.failed)) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
