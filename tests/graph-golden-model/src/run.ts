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
import { loadCases, type CaseSide, type EdgeCase, type GraphCase, type NlCase, type NodeCase, type RecordCase } from './cases.ts';
import { runNodeOp } from './node-op.ts';
import { runEdgeOp } from './edge-op.ts';
import { runNlOp } from './nl-op.ts';
import { runRecordOp } from './record-op.ts';
import { resolveCriteria, runJudge } from './judge.ts';
import { scoreEdge, scoreNode, scoreNl, scoreRecord, type Check } from './score.ts';
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

async function runEdgeCase(c: EdgeCase, graphTransport: LlmTransport, judgeTransport: LlmTransport, settings: ReturnType<typeof resolveSettings>): Promise<CaseDetail> {
  const source = await resolveSide(c.source, graphTransport, settings);
  const target = await resolveSide(c.target, graphTransport, settings);
  const result = await runEdgeOp(source.ref, target.ref, graphTransport, settings);
  const scored = scoreEdge(c, result);
  const derivedClaims =
    source.derived || target.derived ? { source: source.derived, target: target.derived } : undefined;

  // Phase 4: optionally judge the primary edge's natural-language reasoning.
  const checks: Check[] = [...scored.checks];
  let nl: CaseDetail['nl'];
  if (c.expect.judge_reasoning && c.expect.judge_reasoning.length) {
    const primary = [...result.edges].filter((e) => e.valid).sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
    if (!primary) {
      checks.push({ name: 'reasoning judged', pass: false, detail: 'no valid edge to judge' });
    } else {
      const criteria = resolveCriteria('reasoning', c.expect.judge_reasoning, undefined);
      const reference = `Source claims: ${JSON.stringify(source.ref.key_claims)}\nTarget claims: ${JSON.stringify(target.ref.key_claims)}\nChosen relation: ${primary.relation}`;
      const jr = await runJudge({ transport: judgeTransport, input: reference, field: 'edge reasoning', output: primary.reasoning, criteria });
      checks.push({ name: 'reasoning judge returned valid JSON', pass: jr.ok && !!jr.verdict, detail: jr.ok ? undefined : jr.summary });
      const verdicts = (jr.verdict?.criteria ?? []).map((v) => ({ name: v.name, verdict: v.verdict, reason: v.reason }));
      if (jr.ok && jr.verdict) {
        const vmap = new Map(jr.verdict.criteria.map((v) => [v.name.toLowerCase(), v]));
        for (const crit of criteria) {
          const v = vmap.get(crit.name.toLowerCase());
          const got = v ? (v.verdict.trim().toLowerCase() === 'pass' ? 'pass' : 'fail') : undefined;
          checks.push({ name: `reasoning ${crit.name}: expect pass`, pass: got === 'pass', detail: v ? `judge=${got} — ${v.reason}` : 'omitted' });
        }
      }
      nl = { field: 'edge reasoning', output: primary.reasoning, verdicts };
    }
  }
  const passed = checks.filter((ck) => ck.pass).length;

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
    ...(nl ? { nl } : {}),
    checks,
    parseOk: scored.parseOk,
    schemaOk: scored.schemaOk,
    passed,
    total: checks.length,
    expectedPrimary: scored.expectedPrimary,
    predictedPrimary: scored.predictedPrimary,
  };
}

async function runNlCase(c: NlCase, graphTransport: LlmTransport, judgeTransport: LlmTransport, settings: ReturnType<typeof resolveSettings>, model: string): Promise<CaseDetail> {
  const result = await runNlOp(c, graphTransport, judgeTransport, settings);
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

/** One execution of a record case → a CaseDetail (no repeat aggregation). */
async function recordDetailOnce(
  c: RecordCase,
  graphTransport: LlmTransport,
  judgeTransport: LlmTransport,
  settings: ReturnType<typeof resolveSettings>,
  graphModel: string,
  judgeModel: string
): Promise<CaseDetail> {
  const result = await runRecordOp(c, graphTransport, judgeTransport, settings, graphModel, judgeModel);
  const scored = scoreRecord(c, result);
  const judges = result.judges.map((jf) => ({
    field: jf.field,
    output: jf.output,
    verdicts: (jf.judge.verdict?.criteria ?? []).map((v) => ({ name: v.name, verdict: v.verdict, reason: v.reason })),
  }));
  return {
    name: c.name,
    kind: 'record',
    op: c.op,
    inputSource: c.input_source,
    sourceNote: c.source_note,
    description: c.description,
    model: graphModel,
    mocked: result.mocked,
    latencyMs: result.latencyMs,
    messages: result.messages,
    raw: result.raw,
    parse: result.parse,
    payload: result.node?.payload,
    edges: result.edge?.edges,
    derivedClaims: result.derivedClaims,
    judges,
    checks: scored.checks,
    parseOk: scored.parseOk,
    schemaOk: scored.schemaOk,
    passed: scored.passed,
    total: scored.total,
    expectedPrimary: scored.expectedPrimary,
    predictedPrimary: scored.predictedPrimary,
  };
}

async function runRecordCase(
  c: RecordCase,
  loopGraphTransport: LlmTransport,
  loopJudgeTransport: LlmTransport,
  settings: ReturnType<typeof resolveSettings>,
  loopGraphModel: string,
  loopJudgeModel: string
): Promise<CaseDetail> {
  const graphModel = c.model ?? loopGraphModel;
  const judgeModel = c.judge_model ?? loopJudgeModel;
  const repeat = Math.max(1, Math.floor(c.repeat ?? 1));
  const overrides = c.model !== undefined || c.judge_model !== undefined;

  // Reuse the loop transports unless the case overrides a model, or repeat>1 (then bypass the cache
  // so each run samples real run-to-run variance rather than replaying one cached completion).
  let graphTransport = loopGraphTransport;
  let judgeTransport = loopJudgeTransport;
  if (overrides || repeat > 1) {
    const s = repeat > 1 ? { ...settings, cache: false } : settings;
    graphTransport = makeTransport(s, graphModel);
    judgeTransport = judgeModel === graphModel ? graphTransport : makeTransport(s, judgeModel);
  }

  if (repeat === 1) {
    return recordDetailOnce(c, graphTransport, judgeTransport, settings, graphModel, judgeModel);
  }

  const runs: CaseDetail[] = [];
  for (let r = 0; r < repeat; r++) {
    runs.push(await recordDetailOnce(c, graphTransport, judgeTransport, settings, graphModel, judgeModel));
  }
  const fullyPassed = runs.filter((d) => d.passed === d.total).length;
  const base = runs[0];
  const consistency: Check = {
    name: `consistency across ${repeat} runs`,
    pass: fullyPassed === repeat,
    detail: `${fullyPassed}/${repeat} runs fully passed`,
  };
  return {
    ...base,
    checks: [...base.checks, consistency],
    passed: base.passed + (consistency.pass ? 1 : 0),
    total: base.total + 1,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const mode = (argv[0] && !argv[0].startsWith('--') ? argv[0] : 'all') as 'node' | 'edge' | 'nl' | 'record' | 'all';
  const settings = resolveSettings(argv);
  if (settings.clearCache) clearCache();

  const all = loadCases(settings.only);
  const cases: GraphCase[] = all.filter((c) => mode === 'all' || c.kind === mode);

  console.log('FlashQuery graph golden-model — prompt refinement workbench');
  console.log(
    `mode=${mode}  models=${settings.models.join(', ')}  judge=${settings.judgeModel ?? '(same as graph)'}  ` +
      `base=${settings.mock ? '(mock)' : settings.baseUrl}  ` +
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
    // Graph transport runs analyze_node / classify_edge; judge transport runs LLM-as-judge. They
    // differ only when --judge-model is set (otherwise the judge uses the same model as the graph).
    const graphTransport = makeTransport(settings, model);
    const judgeModel = settings.judgeModel ?? model;
    const judgeTransport = settings.judgeModel ? makeTransport(settings, judgeModel) : graphTransport;
    const details: CaseDetail[] = [];
    console.log(`\n========== model: ${model}${settings.judgeModel ? `  (judge: ${judgeModel})` : ''} ==========`);
    let i = 0;
    for (const c of cases) {
      i++;
      // Live progress: print before the (possibly slow) model call, then the result. NL extract
      // and record cases are multi-call and slow on weak local models, so this prevents "looks hung".
      process.stdout.write(`  [${i}/${cases.length}] ${c.kind}${c.kind === 'record' ? `/${c.op}` : ''} ${c.name} … `);
      const detail =
        c.kind === 'node'
          ? await runNodeCase(c, graphTransport, settings)
          : c.kind === 'edge'
            ? await runEdgeCase(c, graphTransport, judgeTransport, settings)
            : c.kind === 'nl'
              ? await runNlCase(c, graphTransport, judgeTransport, settings, model)
              : await runRecordCase(c, graphTransport, judgeTransport, settings, model, judgeModel);
      details.push(detail);
      console.log(`${detail.passed === detail.total ? 'PASS' : 'FAIL'} (${detail.passed}/${detail.total})`);
      for (const ck of detail.checks) {
        if (!ck.pass) console.log(`        · MISS ${ck.name}${ck.detail ? `  [${ck.detail}]` : ''}`);
      }
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
