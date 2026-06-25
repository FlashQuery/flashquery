// CLI entry. Usage:
//   npm run node | edge | all                 # run that kind of case
//   npm run selftest                          # offline (canned model) — verifies the harness
//   tsx src/run.ts all --model granite4,llama3.1:8b   # several models, one report
//
// Flags: --model <a,b,..> --base-url <url> --api-key <k> --only <substr>
//        --inject-vocabulary --inject-schema --temperature <n> --mock
//
// Every invocation writes a full report under results/<timestamp>/.

import { resolveSettings } from './config.ts';
import { clearCache, makeTransport, type LlmTransport } from './llm-client.ts';
import { loadCases, type CaseSide, type EdgeCase, type GraphCase, type NlCase, type NodeCase } from './cases.ts';
import { runNodeOp } from './node-op.ts';
import { runEdgeOp } from './edge-op.ts';
import { runNlOp } from './nl-op.ts';
import { scoreEdge, scoreNode, scoreNl } from './score.ts';
import {
  printCrossModel,
  printModelRun,
  summarize,
  writeReport,
  type CaseDetail,
  type ModelRun,
  type Report,
} from './report.ts';
import type { ChunkRef } from './prompts.ts';

/** Resolve a case side to the key_claims the edge prompt needs. If the side gives
 *  raw text, derive claims by running node analysis first (chained pipeline). */
async function resolveSide(
  side: CaseSide,
  transport: LlmTransport,
  settings: ReturnType<typeof resolveSettings>
): Promise<{ ref: ChunkRef; derived?: string[] }> {
  if (side.key_claims && side.key_claims.length > 0) {
    return { ref: { chunk_id: side.chunk_id, key_claims: side.key_claims } };
  }
  if (side.text) {
    const node = await runNodeOp({ content: side.text }, transport, settings);
    const claims = node.payload?.key_claims ?? [];
    return { ref: { chunk_id: side.chunk_id, key_claims: claims }, derived: claims };
  }
  return { ref: { chunk_id: side.chunk_id, key_claims: [] } };
}

async function runNodeCase(c: NodeCase, transport: LlmTransport, settings: ReturnType<typeof resolveSettings>): Promise<CaseDetail> {
  const result = await runNodeOp({ content: c.input }, transport, settings);
  const scored = scoreNode(c, result);
  return {
    name: c.name,
    kind: 'node',
    description: c.description,
    model: result.model,
    mocked: result.mocked,
    latencyMs: result.latencyMs,
    messages: result.messages,
    raw: result.raw,
    parse: result.parse,
    payload: result.payload,
    checks: scored.checks,
    parseOk: scored.parseOk,
    schemaOk: scored.schemaOk,
    passed: scored.passed,
    total: scored.total,
  };
}

async function runEdgeCase(c: EdgeCase, transport: LlmTransport, settings: ReturnType<typeof resolveSettings>): Promise<CaseDetail> {
  const source = await resolveSide(c.source, transport, settings);
  const target = await resolveSide(c.target, transport, settings);
  const result = await runEdgeOp(source.ref, target.ref, transport, settings);
  const scored = scoreEdge(c, result);
  const derivedClaims =
    source.derived || target.derived ? { source: source.derived, target: target.derived } : undefined;
  return {
    name: c.name,
    kind: 'edge',
    description: c.description,
    model: result.model,
    mocked: result.mocked,
    latencyMs: result.latencyMs,
    messages: result.messages,
    raw: result.raw,
    parse: result.parse,
    edges: result.edges,
    derivedClaims,
    checks: scored.checks,
    parseOk: scored.parseOk,
    schemaOk: scored.schemaOk,
    passed: scored.passed,
    total: scored.total,
    expectedPrimary: scored.expectedPrimary,
    predictedPrimary: scored.predictedPrimary,
  };
}

async function runNlCase(c: NlCase, transport: LlmTransport, settings: ReturnType<typeof resolveSettings>, model: string): Promise<CaseDetail> {
  const result = await runNlOp(c, transport, settings);
  const scored = scoreNl(c, result);
  const verdicts = (result.judge.verdict?.criteria ?? []).map((v) => ({ name: v.name, verdict: v.verdict, reason: v.reason }));
  return {
    name: c.name,
    kind: 'nl',
    description: c.description,
    model,
    mocked: settings.mock,
    latencyMs: result.latencyMs,
    messages: [{ role: 'user', content: result.judge.prompt }],
    raw: result.judge.raw,
    parse: { ok: result.judge.ok, repaired: false, ...(result.judge.failure ? { failure: result.judge.failure } : {}), ...(result.judge.summary ? { summary: result.judge.summary } : {}) },
    nl: { field: result.field, output: result.output, verdicts },
    checks: scored.checks,
    parseOk: scored.parseOk,
    schemaOk: scored.schemaOk,
    passed: scored.passed,
    total: scored.total,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'all') as 'node' | 'edge' | 'nl' | 'all';
  const settings = resolveSettings(argv);
  if (settings.clearCache) clearCache();

  const all = loadCases(settings.only);
  const cases: GraphCase[] = all.filter((c) => mode === 'all' || c.kind === mode);

  console.log('FlashQuery graph golden-model — prompt refinement workbench');
  console.log(
    `mode=${mode}  models=${settings.models.join(', ')}  base=${settings.mock ? '(mock)' : settings.baseUrl}  ` +
      `prompts=${settings.baseline ? 'production-baseline' : 'local-refined'}  temp=${settings.temperature}  ` +
      `reasoning_effort=${settings.reasoningEffort ?? '(unset)'}  cache=${settings.cache ? 'on' : 'off'}`
  );
  console.log(`cases: ${cases.length}`);
  if (cases.length === 0) {
    console.log('\nNo cases found. Add YAML cases under cases/ (see cases/README.md).');
    return;
  }

  const runs: ModelRun[] = [];
  for (const model of settings.models) {
    const transport = makeTransport(settings, model);
    const details: CaseDetail[] = [];
    for (const c of cases) {
      if (c.kind === 'node') details.push(await runNodeCase(c, transport, settings));
      else if (c.kind === 'edge') details.push(await runEdgeCase(c, transport, settings));
      else details.push(await runNlCase(c, transport, settings, model));
    }
    const run: ModelRun = { model, cases: details, summary: summarize(details) };
    runs.push(run);
    printModelRun(run);
  }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    mode,
    settings: {
      baseUrl: settings.baseUrl,
      mock: settings.mock,
      injectVocabulary: settings.injectVocabulary,
      injectSchema: settings.injectSchema,
      temperature: settings.temperature,
    },
    runs,
  };
  printCrossModel(report);
  const dir = writeReport(report);
  console.log(`\nReport written: ${dir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
