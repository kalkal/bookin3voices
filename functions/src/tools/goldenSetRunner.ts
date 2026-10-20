// Golden-set runner — the prompt regression brake.
//
// Runs ALL the passages in content/style-profiles/suspense/golden-set/
// against the current prompt (buildRefinePrompt = Style Bible + few-shot +
// format rules) and MECHANICALLY verifies whatever can be verified
// (quality priorities):
//   - valid format (Zod) and original locatable exactly once in the passage;
//   - a single proposal for grammar suggestions;
//   - density within the passage limits (checks.json) and an absolute cap of 30;
//   - zero spans touching the "MUST NOT" zones (checks.json): a suggestion
//     crossing a protected zone is fine only if EVERY proposal carries
//     the protected text UNCHANGED;
//   - coverage of the "MUST" items (reported as a diagnostic: the quality
//     judgment stays human, the runner counts).
//
// Must be re-run on EVERY change to the Style Bible / few-shot / prompt / model.
// The final quality judgment stays human: the runner only blocks
// mechanical regressions.
//
// Usage: npm run golden -- [--model X] [--fallback Y] [--only 04] [--out report.md]
// Provider: AI_PROVIDER (bedrock = Amazon Nova, the default, through the AWS
// credential chain, e.g. AWS_PROFILE; gemini = env GEMINI_API_KEY), the same
// factory the callables use. Fictitious passages only. Keys are never printed.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { normalizeSuggestions, MAX_SUGGESTIONS } from '../ai/normalizeSuggestions';
import { createProvider, selectProviderName, type ModelRole } from '../ai/provider/factory';
import { ProviderModel } from '../ai/provider/ProviderModel';
import { AiProviderError, isRetryableAiError } from '../ai/provider/types';
import { buildRefinePrompt, REFINE_TEMPERATURE } from '../ai/refinePrompt';
import { modelOutputSchema, type ModelOutput, type Suggestion } from '../ai/refineTypes';
import { loadStyleProfileContent } from '../ai/styleProfileContent';
import { textHash } from '../ai/textHash';

// ---------- checks.json ----------

interface ProtectedRegionSpec {
  /** Quote from the passage; «…» separates the fragments of an extended zone. */
  quote: string;
  /** Categories allowed to intersect the zone (e.g. grammar on the run-on paragraph). */
  allow?: string[];
  /** 'fail' (default) fails the run; 'warn' flags it for human judgment. */
  level?: 'fail' | 'warn';
  note?: string;
}

interface ExpectedSpec {
  label: string;
  quote: string;
}

interface BranoChecks {
  /** [min, max] of the passage's expected density: above the max is a FAIL. */
  expectedRange: [number, number];
  protected: ProtectedRegionSpec[];
  expected: ExpectedSpec[];
}

type ChecksFile = Record<string, BranoChecks>;

interface Region {
  from: number;
  to: number;
}

/** Locates a quote (with «…» fragments) in the passage. Throws if it is absent:
 *  that means checks.json and the passage have gone out of sync. */
function locateRegions(text: string, quote: string, file: string): Region[] {
  const fragments = quote
    .split('…')
    .map((f) => f.trim())
    .filter((f) => f !== '');
  if (fragments.length === 0) throw new Error(`${file}: empty quote in checks.json`);

  if (fragments.length === 1) {
    const fragment = fragments[0] as string;
    const regions: Region[] = [];
    let index = text.indexOf(fragment);
    while (index !== -1) {
      regions.push({ from: index, to: index + fragment.length });
      index = text.indexOf(fragment, index + 1);
    }
    if (regions.length === 0) {
      throw new Error(`${file}: quote not found in the passage: «${fragment.slice(0, 60)}»`);
    }
    return regions;
  }

  const first = fragments[0] as string;
  const from = text.indexOf(first);
  if (from === -1) throw new Error(`${file}: fragment not found: «${first.slice(0, 60)}»`);
  let cursor = from + first.length;
  for (const fragment of fragments.slice(1)) {
    const at = text.indexOf(fragment, cursor);
    if (at === -1)
      throw new Error(
        `${file}: fragment not found after the previous one: «${fragment.slice(0, 60)}»`,
      );
    cursor = at + fragment.length;
  }
  return [{ from, to: cursor }];
}

// ---------- passage extraction ----------

function extractBrano(markdown: string, file: string): string {
  const match = /## Brano\s*\n([\s\S]*?)\n## /.exec(markdown);
  if (match === null) throw new Error(`${file}: section «## Brano» not found`);
  // The .md files wrap at ~90 columns for readability: inside a paragraph,
  // single line breaks are formatting, not text. They are unrolled (as
  // dictation would do); paragraphs (blank line) are kept.
  return (match[1] as string)
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .join('\n\n');
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length;
}

// ---------- API key ----------

function resolveApiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  throw new Error('Set the GEMINI_API_KEY environment variable.');
}

// ---------- checking a passage ----------

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

  // grammar with more than one proposal: format violation BEFORE normalization
  const grammarMultiProposal = raw.suggestions.filter(
    (s) => s.kind === 'grammar' && s.proposals.length > 1,
  ).length;
  if (grammarMultiProposal > 0) {
    violations.push({
      level: 'fail',
      message: `${grammarMultiProposal} grammar suggestion(s) with more than one proposal`,
    });
  }

  const { suggestions, discarded } = normalizeSuggestions(raw, text, hash, 'golden');
  if (discarded > 0) {
    violations.push({
      level: 'warn',
      message: `${discarded} suggestion(s) discarded (original missing/ambiguous or empty proposals)`,
    });
  }

  // density: FAIL above the mechanical cap (the larger of the passage maximum
  // and 1 per ~50 words from the Style Bible, never above 30); WARN if outside
  // the passage's human-set range.
  const [minExpected, maxExpected] = checks.expectedRange;
  const failThreshold = Math.min(Math.max(maxExpected, Math.ceil(words / 50)), MAX_SUGGESTIONS);
  // measured on the MODEL output: normalizeSuggestions now cuts to the cap, so the
  // kept count would always pass and hide a prompt that ignores the density
  const densityOk = raw.suggestions.length <= failThreshold;
  if (!densityOk) {
    violations.push({
      level: 'fail',
      message: `model density over the cap: ${raw.suggestions.length} suggestions from the model (cap ${failThreshold}; the code keeps ${suggestions.length})`,
    });
  } else if (suggestions.length > maxExpected) {
    violations.push({
      level: 'warn',
      message: `density above the passage range: ${suggestions.length} > ${maxExpected}`,
    });
  } else if (suggestions.length < minExpected) {
    violations.push({
      level: 'warn',
      message: `density below expectation: ${suggestions.length} < ${minExpected}`,
    });
  }

  // protected zones (MUST NOT)
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
            `protected zone touched («${spec.quote.slice(0, 50)}»): ` +
            `[${sug.kind}] «${sug.original.slice(0, 60)}» → «${(sug.proposals[0] ?? '').slice(0, 60)}»` +
            (spec.note === undefined ? '' : ` — ${spec.note}`),
        });
      }
    }
  }

  // MUST coverage (diagnostic)
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
    violations.push({ level: 'warn', message: `MUST items not covered: ${missed.join('; ')}` });
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

// ---------- model call with retry and fallback ----------

/** Model calls made in this run, attempts included (printed at the end: the cost order). */
let calls = 0;

/** The model answered, but with broken or cut JSON: another attempt can plausibly succeed. */
function isBrokenReply(error: unknown): boolean {
  return (
    error instanceof AiProviderError &&
    (error.detail.kind === 'invalid_json' || error.detail.kind === 'truncated')
  );
}

export async function generateWithRetry(
  models: ProviderModel[],
  prompt: ReturnType<typeof buildRefinePrompt>,
): Promise<{ output: ModelOutput; modelName: string }> {
  let lastError: unknown;
  const attempts: ProviderModel[] = [models[0] as ProviderModel, ...models];
  for (const model of attempts) {
    calls += 1;
    try {
      const raw = await model.generate(prompt);
      return { output: modelOutputSchema.parse(raw), modelName: model.modelName };
    } catch (error) {
      lastError = error;
      const label = error instanceof Error ? error.message.slice(0, 160) : String(error);
      console.warn(`  attempt failed on ${model.modelName}: ${label}`);
      if (
        !isRetryableAiError(error) &&
        !isBrokenReply(error) &&
        !(error instanceof Error && error.name === 'ZodError')
      ) {
        // non-retryable errors (e.g. auth, 400): no point insisting on the same input
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
  lines.push(`# Golden set — report of ${startedAt.toISOString().slice(0, 16).replace('T', ' ')}`);
  lines.push('');
  lines.push(
    `Result: ${failed.length === 0 ? 'GREEN ✅' : `RED ❌ (${failed.length} passages with FAIL)`}`,
  );
  lines.push('');
  lines.push('| Passage | Words | Model | Sugg. | Expected range | MUST covered | FAIL | WARN |');
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
      `${r.count} suggestions kept (${r.rawCount} from the model, ${r.discarded} discarded) over ${r.words} words.`,
    );
    for (const v of r.violations) lines.push(`- **${v.level.toUpperCase()}** ${v.message}`);
    if (r.coverage.missed.length === 0 && r.violations.length === 0) lines.push('- no findings');
    lines.push('', '<details><summary>Suggestions</summary>', '');
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
  // Same provider, model ids and env var names as the callables (AI_PROVIDER,
  // BEDROCK_MODEL_ID*, GEMINI_MODEL_REFINE*): the script loads functions/.env when
  // it exists, so without arguments it exercises the configured model; otherwise
  // the regression brake would report green on a model other than the one in service.
  // --model / --fallback override the configured model ids of the selected provider.
  const envFile = path.resolve(__dirname, '..', '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const env = { ...process.env };
  const providerName = selectProviderName(env);
  const primaryArg = argValue('model');
  const fallbackArg = argValue('fallback');
  if (providerName === 'bedrock') {
    if (primaryArg !== undefined) env.BEDROCK_MODEL_ID = primaryArg;
    if (fallbackArg !== undefined) env.BEDROCK_MODEL_ID_FALLBACK = fallbackArg;
  }
  const geminiNames: Record<ModelRole, string> = {
    primary: primaryArg ?? env.GEMINI_MODEL_REFINE ?? 'gemini-3.5-flash',
    fallback: fallbackArg ?? env.GEMINI_MODEL_REFINE_FALLBACK ?? 'gemini-3.6-flash',
    outline: env.GEMINI_MODEL_PRO ?? '',
  };
  const only = argValue('only');
  const out = argValue('out');
  const dry = process.argv.includes('--dry');

  const deps = {
    env,
    gemini: { model: (role: ModelRole) => geminiNames[role], apiKey: resolveApiKey },
  };
  const modelFor = (role: ModelRole) =>
    new ProviderModel(() => createProvider(deps, role), REFINE_TEMPERATURE);
  const primary = modelFor('primary');
  const models = [primary];
  const fallback = modelFor('fallback');
  if (fallback.modelName !== '' && fallback.modelName !== primary.modelName) {
    models.push(fallback);
  }
  console.log(`Provider ${providerName}: ${models.map((m) => m.modelName).join(' → fallback ')}`);

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
  if (files.length === 0) throw new Error('no passage selected');

  const reports: BranoReport[] = [];
  for (const file of files) {
    const checks = checksFile[file];
    if (checks === undefined) throw new Error(`${file}: entry missing from checks.json`);
    const markdown = readFileSync(path.join(goldenDir, file), 'utf8');
    const text = extractBrano(markdown, file);

    console.log(`\n▶ ${file} (${countWords(text)} words)…`);
    if (dry) {
      // only validates checks ↔ passage (locateRegions throws if misaligned)
      for (const spec of checks.protected) locateRegions(text, spec.quote, file);
      for (const spec of checks.expected) locateRegions(text, spec.quote, file);
      console.log('  checks aligned with the passage ✓');
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
      `  ${report.count} suggestions (${report.discarded} discarded), MUST ${report.coverage.covered.length}/${report.coverage.covered.length + report.coverage.missed.length}, ${fails.length} FAIL`,
    );
    for (const v of report.violations) console.log(`  ${v.level.toUpperCase()}: ${v.message}`);
  }

  if (dry) {
    console.log('\nDry run: checks.json and passages aligned.');
    return;
  }

  const rendered = renderReport(reports, startedAt);
  if (out !== undefined) {
    writeFileSync(out, rendered, 'utf8');
    console.log(`\nReport written to ${out}`);
  }
  console.log(`\n${rendered}`);
  console.log(`\nModel calls: ${calls} (attempts included) for ${reports.length} passage(s).`);

  if (reports.some((r) => r.failed)) process.exitCode = 1;
}

// Run only as a script (`npm run golden`), not when a test imports the helpers.
if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
