// Reporting. Every run writes a complete, timestamped report (JSON + Markdown)
// under results/ — no flag required — because the report IS the feedback loop:
// it captures, for every case and every model, the exact prompt sent, the raw
// model output, the parsed result, validation errors, and which expectations
// passed or failed. That's what tells you how to refine a prompt (or fix a bug
// in the TS) so the categorizations / relationships we expect actually appear.

import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalGraphNodeAnalysisPayload } from './local-schemas.ts';
import type { Settings } from './config.ts';
import type { ChatMessage } from './llm-client.ts';
import type { ParseInfo } from './node-op.ts';
import type { ValidatedEdge } from './edge-op.ts';
import type { Check } from './score.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'results');

export interface CaseDetail {
  name: string;
  kind: 'node' | 'edge';
  description?: string;
  model: string;
  mocked: boolean;
  latencyMs: number;
  messages: ChatMessage[];
  raw: string;
  parse: ParseInfo;
  payload?: LocalGraphNodeAnalysisPayload;
  edges?: ValidatedEdge[];
  derivedClaims?: { source?: string[]; target?: string[] };
  checks: Check[];
  parseOk: boolean;
  schemaOk: boolean;
  passed: number;
  total: number;
  expectedPrimary?: string;
  predictedPrimary?: string;
}

export interface ModelRun {
  model: string;
  cases: CaseDetail[];
  summary: { fixturesPassing: number; fixturesTotal: number; checksPassed: number; checksTotal: number };
}

export interface Report {
  generatedAt: string;
  mode: string;
  settings: Pick<Settings, 'baseUrl' | 'mock' | 'injectVocabulary' | 'injectSchema' | 'temperature'>;
  runs: ModelRun[];
}

export function summarize(cases: CaseDetail[]): ModelRun['summary'] {
  return {
    fixturesPassing: cases.filter((c) => c.passed === c.total).length,
    fixturesTotal: cases.length,
    checksPassed: cases.reduce((n, c) => n + c.passed, 0),
    checksTotal: cases.reduce((n, c) => n + c.total, 0),
  };
}

// ── Console ─────────────────────────────────────────────────────────────────
export function printModelRun(run: ModelRun): void {
  console.log(`\n========== model: ${run.model} ==========`);
  for (const c of run.cases) {
    const ok = c.passed === c.total;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] (${c.kind}) ${c.name}  (${c.passed}/${c.total})${c.description ? ` — ${c.description}` : ''}`);
    if (!c.parseOk) console.log('       · parse FAILED (no valid JSON)');
    else if (!c.schemaOk) console.log('       · schema FAILED (parsed but violated strict schema)');
    for (const ck of c.checks) if (!ck.pass) console.log(`       · MISS ${ck.name}${ck.detail ? `  [${ck.detail}]` : ''}`);
  }
  printConfusionMatrix(run.cases);
  const s = run.summary;
  console.log(`\n  ${run.model}: fixtures ${s.fixturesPassing}/${s.fixturesTotal}, checks ${s.checksPassed}/${s.checksTotal}`);
}

function confusionLabels(cases: CaseDetail[]): string[] {
  const labelled = cases.filter((c) => c.kind === 'edge' && c.expectedPrimary);
  return Array.from(
    new Set(labelled.flatMap((c) => [c.expectedPrimary!, c.predictedPrimary ?? '(none)']))
  ).sort();
}

export function printConfusionMatrix(cases: CaseDetail[]): void {
  const labelled = cases.filter((c) => c.kind === 'edge' && c.expectedPrimary);
  if (labelled.length === 0) return;
  const labels = confusionLabels(cases);
  const counts = new Map<string, Map<string, number>>();
  for (const c of labelled) {
    const exp = c.expectedPrimary!;
    const pred = c.predictedPrimary ?? '(none)';
    if (!counts.has(exp)) counts.set(exp, new Map());
    const row = counts.get(exp)!;
    row.set(pred, (row.get(pred) ?? 0) + 1);
  }
  const w = Math.max(14, ...labels.map((l) => l.length));
  const pad = (s: string) => s.padEnd(w);
  console.log('\n  Edge confusion matrix (rows=expected, cols=predicted):');
  console.log('  ' + pad('exp\\pred') + labels.map((l) => l.slice(0, 6).padStart(8)).join(''));
  for (const exp of labels) {
    const row = counts.get(exp);
    if (!row) continue;
    console.log('  ' + pad(exp) + labels.map((l) => String(row.get(l) ?? 0).padStart(8)).join(''));
  }
}

export function printCrossModel(report: Report): void {
  if (report.runs.length < 2) return;
  console.log('\n========== cross-model comparison ==========');
  for (const run of report.runs) {
    const s = run.summary;
    console.log(`  ${run.model.padEnd(24)} fixtures ${s.fixturesPassing}/${s.fixturesTotal}  checks ${s.checksPassed}/${s.checksTotal}`);
  }
}

// ── File output ───────────────────────────────────────────────────────────────
export function writeReport(report: Report): string {
  fs.mkdirSync(RESULTS, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const dir = join(RESULTS, stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(join(dir, 'report.md'), toMarkdown(report));
  return dir;
}

function toMarkdown(report: Report): string {
  const L: string[] = [];
  L.push(`# Graph golden-model report`);
  L.push('');
  L.push(`- Generated: ${report.generatedAt}`);
  L.push(`- Mode: ${report.mode}`);
  L.push(`- Endpoint: ${report.settings.mock ? '(mock)' : report.settings.baseUrl}`);
  L.push(`- inject_vocabulary: ${report.settings.injectVocabulary} · inject_schema: ${report.settings.injectSchema} · temperature: ${report.settings.temperature}`);
  L.push(`- Models: ${report.runs.map((r) => r.model).join(', ')}`);
  L.push('');
  for (const run of report.runs) {
    const s = run.summary;
    L.push(`## Model: \`${run.model}\``);
    L.push('');
    L.push(`Fixtures passing: **${s.fixturesPassing}/${s.fixturesTotal}** · Checks: **${s.checksPassed}/${s.checksTotal}**`);
    L.push('');
    L.push(`| case | kind | result | score | expected→predicted |`);
    L.push(`| --- | --- | --- | --- | --- |`);
    for (const c of run.cases) {
      const res = c.passed === c.total ? 'PASS' : 'FAIL';
      const prim = c.kind === 'edge' && c.expectedPrimary ? `${c.expectedPrimary}→${c.predictedPrimary ?? '(none)'}` : '';
      L.push(`| ${c.name} | ${c.kind} | ${res} | ${c.passed}/${c.total} | ${prim} |`);
    }
    L.push('');
    // Detailed diagnostics for failing cases.
    const failing = run.cases.filter((c) => c.passed !== c.total);
    if (failing.length) {
      L.push(`### Failing cases — diagnostics`);
      L.push('');
      for (const c of failing) {
        L.push(`#### ${c.name} (${c.kind}) — model \`${c.model}\``);
        if (!c.parseOk) L.push(`- parse FAILED: ${c.parse.summary ?? 'no valid JSON returned'}`);
        else if (!c.schemaOk) L.push(`- schema FAILED: ${c.parse.summary ?? 'violated strict schema'}`);
        for (const ck of c.checks) if (!ck.pass) L.push(`- MISS: ${ck.name}${ck.detail ? ` — ${ck.detail}` : ''}`);
        L.push('');
        L.push(`<details><summary>prompt sent</summary>`);
        L.push('');
        for (const m of c.messages) {
          L.push('```');
          L.push(`[${m.role}]`);
          L.push(m.content);
          L.push('```');
        }
        L.push(`</details>`);
        L.push('');
        L.push(`<details><summary>raw model output</summary>`);
        L.push('');
        L.push('```json');
        L.push(c.raw.slice(0, 4000));
        L.push('```');
        L.push(`</details>`);
        L.push('');
      }
    }
  }
  return L.join('\n');
}
