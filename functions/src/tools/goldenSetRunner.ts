// Golden-set runner — the prompt regression brake.
//
// Runs ALL the passages in content/style-profiles/<profile>/golden-set/ (suspense
// by default, --profile for another style)
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
// Usage: npm run golden -- [--profile historical] [--model X] [--fallback Y] [--only 04]
//   [--out report.md] [--offline]
// --offline (npm run golden:offline, and the goldenSetOffline jest test): replays the
// hand-written answers in golden-set/recorded/ through the same factory with a fake
// Bedrock client. No network and no real model call: it checks the code side
// (normalization, proposal guard, density) on every passage that has a recording;
// the prompt and the model still need the live run.
// Provider: Amazon Nova on Bedrock, through the AWS credential chain (e.g.
// AWS_PROFILE), the same factory the callables use. Fictitious passages only.
// Keys are never printed.

import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { normalizeSuggestions, MAX_SUGGESTIONS } from '../ai/normalizeSuggestions';
import { createProvider, selectProviderName, type ModelRole } from '../ai/provider/factory';
import { ProviderModel } from '../ai/provider/ProviderModel';
import { AiProviderError, isRetryableAiError } from '../ai/provider/types';
import { buildRefinePrompt, REFINE_TEMPERATURE } from '../ai/refinePrompt';
import { historyOptionsForBook } from '../ai/refineChapter';
import { modelOutputSchema, type ModelOutput, type Suggestion } from '../ai/refineTypes';
import { loadStyleProfileContent } from '../ai/styleProfileContent';
import { DEFAULT_STYLE_ID, STYLE_IDS, type StyleId } from '../ai/styles';
import { mergeWithHistory, runHistoryCheckWithin } from '../ai/history/historyCheck';
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
  /** Book language for the prompt; default 'it'. */
  language?: 'it' | 'en';
  /** Whether the passage names a recognisable period: history suggestions are expected only then. */
  period?: boolean;
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

export function checkBrano(
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
      message: `${discarded} suggestion(s) discarded (original missing/ambiguous, empty proposals, or proposals that would delete or replace text)`,
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

  // history: only when the passage names a period; both parts; always a hint to check
  const history = suggestions.filter((s) => s.kind === 'history');
  if (checks.period !== true && history.length > 0) {
    violations.push({
      level: 'fail',
      message: `${history.length} history suggestion(s) on a passage with no period`,
    });
  }
  if (checks.period === true) {
    for (const aspect of ['period', 'anachronism'] as const) {
      if (!history.some((s) => s.aspect === aspect)) {
        violations.push({ level: 'fail', message: `history: no "${aspect}" suggestion` });
      }
    }
  }
  const prefix = checks.language === 'en' ? 'To check:' : 'Da verificare:';
  const notHedged = history.filter((s) => !s.rationale.trim().startsWith(prefix)).length;
  if (notHedged > 0) {
    violations.push({
      level: 'fail',
      message: `${notHedged} history rationale(s) not starting with «${prefix}»`,
    });
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
    (error.detail.kind === 'invalid_json' ||
      error.detail.kind === 'truncated' ||
      // Nova: "Model produced invalid sequence as part of ToolUse" (refineChapter retries it too)
      (error.detail.kind === 'bad_request' && error.detail.message.includes('ModelErrorException')))
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
        `- [${s.kind}${s.aspect ? `/${s.aspect}` : ''}] «${s.original}» → ${s.proposals.map((p) => `«${p}»`).join(' / ')} — ${s.rationale}`,
      );
    }
    lines.push('', '</details>');
  }
  return lines.join('\n');
}

// ---------- offline replay ----------

/** content/style-profiles/<profile>/golden-set: each style can carry its own set. */
function goldenDir(profile: StyleId): string {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    'content',
    'style-profiles',
    profile,
    'golden-set',
  );
}
const recordedDir = (profile: StyleId) => path.join(goldenDir(profile), 'recorded');

interface Recording {
  /** The model answer, exactly as the tool_use input Nova would return. */
  output: unknown;
  /** Originals whose proposals delete or replace text: they must not survive. */
  mustDrop?: string[];
}

/** Passages with a recorded answer (file names of the .md passages). */
export function listRecordings(profile: StyleId = DEFAULT_STYLE_ID): string[] {
  if (!existsSync(recordedDir(profile))) return [];
  return readdirSync(recordedDir(profile))
    .filter((f) => /^\d\d-.*\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, '.md'))
    .sort();
}

/**
 * One passage through the provider factory with a fake Bedrock client that
 * answers with the recording (a Converse tool_use reply). History is not
 * replayed: it takes several calls and has its own tests.
 */
export async function runOfflinePassage(
  file: string,
  profile: StyleId = DEFAULT_STYLE_ID,
): Promise<{ report: BranoReport; mustDrop: string[]; sent: number }> {
  const dir = goldenDir(profile);
  const checksFile = JSON.parse(readFileSync(path.join(dir, 'checks.json'), 'utf8')) as ChecksFile;
  const checks = checksFile[file];
  if (checks === undefined) throw new Error(`${file}: entry missing from checks.json`);
  const recording = JSON.parse(
    readFileSync(path.join(recordedDir(profile), file.replace(/\.md$/, '.json')), 'utf8'),
  ) as Recording;
  const text = extractBrano(readFileSync(path.join(dir, file), 'utf8'), file);

  let sent = 0;
  const client = {
    send: async () => {
      sent += 1;
      return {
        stopReason: 'tool_use',
        output: {
          message: {
            role: 'assistant',
            content: [
              {
                toolUse: { toolUseId: 'recorded', name: 'return_result', input: recording.output },
              },
            ],
          },
        },
      };
    },
  } as unknown as BedrockRuntimeClient;
  const deps = {
    env: { AI_PROVIDER: 'bedrock', BEDROCK_MODEL_ID: 'recorded-nova' },
    createBedrockClient: () => client,
  };
  const model = new ProviderModel(() => createProvider(deps, 'primary'), REFINE_TEMPERATURE);
  const content = loadStyleProfileContent(profile);
  const prompt = buildRefinePrompt({
    styleBible: content.styleBible,
    fewShots: content.fewShots,
    book: { title: 'Golden set', genre: '', language: checks.language ?? 'it', synopsis: '' },
    chapter: { title: file.replace(/\.md$/, ''), outline: null },
    text,
  });
  const output = modelOutputSchema.parse(await model.generate(prompt));
  const report = checkBrano(file, text, checks, output, model.modelName);
  return { report, mustDrop: recording.mustDrop ?? [], sent };
}

async function runOffline(only: string | undefined, profile: StyleId): Promise<void> {
  const files = listRecordings(profile).filter((f) =>
    only === undefined ? true : only.split(',').some((o) => f.includes(o)),
  );
  if (files.length === 0) throw new Error('no recorded passage selected');
  let failed = false;
  for (const file of files) {
    const { report, mustDrop } = await runOfflinePassage(file, profile);
    const survivors = mustDrop.filter((o) => report.suggestions.some((s) => s.original === o));
    console.log(
      `▶ ${file}: ${report.count}/${report.rawCount} kept, ${report.discarded} discarded, MUST ${report.coverage.covered.length}/${report.coverage.covered.length + report.coverage.missed.length}`,
    );
    for (const v of report.violations) console.log(`  ${v.level.toUpperCase()}: ${v.message}`);
    for (const o of survivors) console.log(`  FAIL: unsafe proposal kept («${o.slice(0, 50)}»)`);
    if (report.failed || survivors.length > 0) failed = true;
  }
  console.log(`\nOffline: ${files.length} recorded passage(s), 0 model calls.`);
  if (failed) process.exitCode = 1;
}

// ---------- main ----------

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

/**
 * --profile historical: the set of another style (default suspense). A typo
 * must stop the run, not replay the default set and report green.
 */
export function profileFromArg(raw: string | undefined): StyleId {
  if (raw === undefined) return DEFAULT_STYLE_ID;
  if (!(STYLE_IDS as readonly string[]).includes(raw)) {
    throw new Error(`unknown --profile "${raw}": use one of ${STYLE_IDS.join(', ')}`);
  }
  return raw as StyleId;
}

async function main(): Promise<void> {
  const profile = profileFromArg(argValue('profile'));
  if (process.argv.includes('--offline')) {
    await runOffline(argValue('only'), profile);
    return;
  }
  const startedAt = new Date();
  // Same provider, model ids and env var names as the callables (AI_PROVIDER,
  // BEDROCK_MODEL_ID*): the script loads functions/.env when
  // it exists, so without arguments it exercises the configured model; otherwise
  // the regression brake would report green on a model other than the one in service.
  // --model / --fallback override the configured model ids.
  const envFile = path.resolve(__dirname, '..', '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const env = { ...process.env };
  const providerName = selectProviderName(env);
  const primaryArg = argValue('model');
  const fallbackArg = argValue('fallback');
  if (primaryArg !== undefined) env.BEDROCK_MODEL_ID = primaryArg;
  if (fallbackArg !== undefined) env.BEDROCK_MODEL_ID_FALLBACK = fallbackArg;
  const only = argValue('only');
  const out = argValue('out');
  const dry = process.argv.includes('--dry');

  const deps = { env };
  const modelFor = (role: ModelRole) =>
    new ProviderModel(() => createProvider(deps, role), REFINE_TEMPERATURE);
  const primary = modelFor('primary');
  const models = [primary];
  const fallback = modelFor('fallback');
  if (fallback.modelName !== '' && fallback.modelName !== primary.modelName) {
    models.push(fallback);
  }
  console.log(`Provider ${providerName}: ${models.map((m) => m.modelName).join(' → fallback ')}`);

  const dir = goldenDir(profile);
  const checksPath = path.join(dir, 'checks.json');
  const checksFile = JSON.parse(readFileSync(checksPath, 'utf8')) as ChecksFile;
  const content = loadStyleProfileContent(profile);

  const files = readdirSync(dir)
    .filter((f) => /^\d\d-.*\.md$/.test(f))
    .filter((f) => (only === undefined ? true : only.split(',').some((o) => f.includes(o))))
    .sort();
  if (files.length === 0) throw new Error('no passage selected');

  const reports: BranoReport[] = [];
  for (const file of files) {
    const checks = checksFile[file];
    if (checks === undefined) throw new Error(`${file}: entry missing from checks.json`);
    const markdown = readFileSync(path.join(dir, file), 'utf8');
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
      styleBible: content.styleBible,
      fewShots: content.fewShots,
      book: { title: 'Golden set', genre: '', language: checks.language ?? 'it', synopsis: '' },
      chapter: { title: file.replace(/\.md$/, ''), outline: null },
      text,
    });
    const { output, modelName } = await generateWithRetry(models, prompt);
    // the history check runs next to the refinement, as in refineChapter
    const history = await runHistoryCheckWithin({
      provider: createProvider(deps, 'primary'),
      text,
      language: checks.language ?? 'it',
      // «Storico» checks every passage, as refineChapter does for every chapter
      ...historyOptionsForBook({ styleProfileId: profile, synopsis: '' }),
    });
    calls += history.calls;
    console.log(
      `  history: period ${history.periodLabel ?? 'none'}, ${history.suggestions.length} kept, ${history.dropped} dropped${history.error ? `, error ${history.error.kind}` : ''}`,
    );
    const merged = { suggestions: mergeWithHistory(output.suggestions, history.suggestions, text) };
    const report = checkBrano(file, text, checks, merged, modelName);
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
