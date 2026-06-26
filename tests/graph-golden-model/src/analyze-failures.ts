// Failure aggregator for a refinement SESSION. Reads the latest result per (model, case) across all
// non-mock reports under results/, then buckets every FAILED check by a normalized signature so
// systematic problems surface as counts instead of one-off observations:
//
//   "provenance_basis present" — 6 failures [FIELD]   (all: got null)
//
// is far more actionable than noticing one case missed provenance. Failures are split into:
//   FIELD     — enum/structural/value mismatches → prompt or logic candidates
//   JUDGE     — LLM-as-judge criterion verdicts  → possible LLMaaJ noise, not necessarily real bugs
//   COVERAGE  — record coverage-guard gaps       → a test is under-specified (fix the case)
//   PARSE/SCHEMA — the model's JSON didn't parse / failed strict Zod
//
// Output is a single, regenerated, TEMPORARY markdown file (results/ is gitignored): run a batch,
// regenerate, read it, adjust the prompt(s), rerun the batch, regenerate again. Delete when done.
//
//   npx tsx src/analyze-failures.ts                       # all kinds, all models
//   npx tsx src/analyze-failures.ts --kind record         # only record cases
//   npx tsx src/analyze-failures.ts --model gemma4:latest --kind record

import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, '..', 'results');
const OUT = join(RESULTS, 'SESSION-FAILURES.md');

interface Check { name: string; pass: boolean; detail?: string }
interface CaseRec {
  name: string;
  kind: string;
  op?: string;
  inputSource?: string;
  model: string;
  passed: number;
  total: number;
  parseOk: boolean;
  schemaOk: boolean;
  checks: Check[];
  generatedAt: string;
}

type Category = 'FIELD' | 'JUDGE' | 'COVERAGE' | 'PARSE/SCHEMA';

/** Collapse case-specific literals so the same kind of failure buckets together. */
function signature(name: string): string {
  return name
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\[[^\]]*\]/g, '[…]')
    .replace(/-?\d+(?:\.\d+)?/g, 'N')
    .trim();
}

function categorize(sig: string): Category {
  if (/^coverage:/.test(sig)) return 'COVERAGE';
  if (/\bjudge\[/.test(sig) || /: expect (pass|fail)$/.test(sig)) return 'JUDGE';
  return 'FIELD';
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  const modelFilter = flag(argv, 'model');
  const kindFilter = flag(argv, 'kind');

  if (!fs.existsSync(RESULTS)) return console.log('No results/ yet.');
  const dirs = fs.readdirSync(RESULTS).filter((d) => fs.existsSync(join(RESULTS, d, 'report.json')));

  const latest = new Map<string, CaseRec>();
  for (const d of dirs) {
    let report: any;
    try { report = JSON.parse(fs.readFileSync(join(RESULTS, d, 'report.json'), 'utf-8')); } catch { continue; }
    if (report.settings?.mock) continue; // mock can't model anything — would pollute the picture
    for (const run of report.runs ?? []) {
      if (modelFilter && run.model !== modelFilter) continue;
      for (const c of run.cases ?? []) {
        if (kindFilter && c.kind !== kindFilter) continue;
        const key = `${run.model} ${c.name}`;
        const prev = latest.get(key);
        if (!prev || report.generatedAt > prev.generatedAt) {
          latest.set(key, {
            name: c.name, kind: c.kind, op: c.op, inputSource: c.inputSource,
            model: run.model, passed: c.passed, total: c.total,
            parseOk: c.parseOk, schemaOk: c.schemaOk, checks: c.checks ?? [],
            generatedAt: report.generatedAt,
          });
        }
      }
    }
  }

  const cases = [...latest.values()];
  if (!cases.length) return console.log('No matching non-mock cases found.');

  interface Bucket { sig: string; category: Category; count: number; items: { case: string; model: string; detail: string }[] }
  const buckets = new Map<string, Bucket>();
  const add = (sig: string, category: Category, c: CaseRec, detail: string) => {
    const k = `${category}␟${sig}`;
    if (!buckets.has(k)) buckets.set(k, { sig, category, count: 0, items: [] });
    const b = buckets.get(k)!;
    b.count++;
    b.items.push({ case: c.name, model: c.model, detail });
  };

  let failingCases = 0;
  for (const c of cases) {
    const isFail = c.passed !== c.total;
    if (isFail) failingCases++;
    if (!c.parseOk) add('invalid JSON (unparseable)', 'PARSE/SCHEMA', c, c.checks.length ? '' : 'parse failed');
    else if (!c.schemaOk) add('failed strict Zod schema', 'PARSE/SCHEMA', c, '');
    for (const ck of c.checks) {
      if (ck.pass) continue;
      const sig = signature(ck.name);
      add(sig, categorize(sig), c, ck.detail ?? '');
    }
  }

  const order: Category[] = ['FIELD', 'JUDGE', 'COVERAGE', 'PARSE/SCHEMA'];
  const byCat = (cat: Category) => [...buckets.values()].filter((b) => b.category === cat).sort((a, b) => b.count - a.count);

  const L: string[] = [];
  L.push('# Session failure ledger (TEMPORARY — regenerate; delete at session end)');
  L.push('');
  L.push(`- Generated: ${new Date().toISOString()}`);
  L.push(`- Scope: ${kindFilter ? `kind=${kindFilter}` : 'all kinds'}${modelFilter ? `, model=${modelFilter}` : ''} · latest result per (model, case)`);
  L.push(`- Cases analyzed: **${cases.length}** · failing: **${failingCases}** · passing: **${cases.length - failingCases}**`);
  L.push('');
  L.push('Failures bucketed by normalized signature (literals/numbers genericized) so a recurring');
  L.push('problem shows as a count. **FIELD** = prompt/logic candidates; **JUDGE** = LLM-as-judge');
  L.push('verdicts (rule out judge noise before treating as a real bug); **COVERAGE** = under-specified');
  L.push('test; **PARSE/SCHEMA** = malformed model JSON. Triage order: README §6.1.');
  L.push('');
  L.push('## Headline counts');
  for (const cat of order) {
    const list = byCat(cat);
    const n = list.reduce((s, b) => s + b.count, 0);
    L.push(`- **${cat}**: ${n} failures across ${list.length} distinct signatures`);
  }
  L.push('');

  for (const cat of order) {
    const list = byCat(cat);
    if (!list.length) continue;
    L.push(`## ${cat} failures`);
    L.push('');
    for (const b of list) {
      L.push(`### ${b.sig} — ${b.count}×`);
      // Compact distinct-detail summary first (the "always fails the same way" signal).
      const detailCounts = new Map<string, number>();
      for (const it of b.items) detailCounts.set(it.detail || '(no detail)', (detailCounts.get(it.detail || '(no detail)') ?? 0) + 1);
      const distinct = [...detailCounts.entries()].sort((a, b) => b[1] - a[1]);
      if (distinct.length <= 3) {
        for (const [d, n] of distinct) L.push(`- ${n}× ${d}`);
      } else {
        L.push(`- ${distinct.length} distinct outcomes (top): ${distinct.slice(0, 3).map(([d, n]) => `${n}× ${d}`).join(' · ')}`);
      }
      L.push('');
      L.push('<details><summary>cases</summary>');
      L.push('');
      for (const it of b.items) L.push(`- \`${it.case}\` (${it.model})${it.detail ? ` — ${it.detail}` : ''}`);
      L.push('');
      L.push('</details>');
      L.push('');
    }
  }

  // Appendix: per-case roll-up so the file is self-contained.
  L.push('## Appendix — per-case results');
  L.push('');
  L.push('| case | kind | input | model | score | result |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const c of cases.sort((a, b) => a.name.localeCompare(b.name))) {
    const kind = c.kind === 'record' && c.op ? `record/${c.op}` : c.kind;
    L.push(`| ${c.name} | ${kind} | ${c.inputSource ?? ''} | ${c.model} | ${c.passed}/${c.total} | ${c.passed === c.total ? 'PASS' : 'FAIL'} |`);
  }

  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(OUT, L.join('\n'));
  console.log(`Wrote ${OUT}`);
  console.log(`Cases: ${cases.length} (${failingCases} failing). Headline:`);
  for (const cat of order) {
    const list = byCat(cat);
    const n = list.reduce((s, b) => s + b.count, 0);
    if (n) console.log(`  ${cat}: ${n} failures / ${list.length} signatures`);
  }
}

main();
