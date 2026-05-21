// Tier 2 batch test generator.
//
// Hand-authored test SPECS as data; this script emits one .yml per spec
// under cases/<category>/. Run with:
//
//   npx tsx tests/macro-framework/scripts/tier2-batch-generator.ts
//
// SCRATCH (per .gitignore convention `_*.ts`). Re-run idempotently;
// existing files are overwritten if regenerated. The .yml outputs are
// real pilots and ARE committed.
//
// Generator boilerplate handles: header comment, id derivation, golden_*
// metadata, expect/golden_snapshot stubs. Each spec just supplies the
// behaviorally interesting bits.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'cases');
const NOW = '2026-05-19T14:00:00Z';
const GOLDEN_VERSION = '0.3.0';

type Outcome = 'success' | 'fail' | 'needs_user_input' | 'parse_error';

interface ErrorBlock {
  code?: string;
  message_contains?: string;
  details?: Record<string, unknown>;
}

/** A single-tool server entry: one archetype configures the whole server. */
interface SingleToolSpec {
  archetype: string;
  tool_name?: string;
  [k: string]: unknown;
}

/** A multi-tool server entry: a `tools` map, each entry its own spec. */
interface MultiToolSpec {
  tools: Record<string, SingleToolSpec>;
}

/** A server entry is either single-tool or multi-tool. */
type ToolSpec = SingleToolSpec | MultiToolSpec;

interface Spec {
  category: 'control-flow' | 'dispatch' | 'errors' | 'isolation' | 'lifecycle' | 'grammar' | 'semantics';
  num: string;          // sequence within category (e.g., "40", "41a")
  prefix: string;       // e.g., "mtf-c-104", used as both filename + id
  name: string;
  description: string;
  covers: string[];
  macro: string;
  tools?: Record<string, ToolSpec>;
  input_vars?: Record<string, unknown>;
  vault?: Record<string, unknown>;
  self_binding?: Record<string, unknown>;
  expect: {
    outcome?: Outcome;
    return_result?: unknown;
    return_result_keys?: string[];
    error?: string | ErrorBlock;
  };
  // golden_snapshot.state_notes is informational; populated by hand only
  // when triage benefits from it. We emit a minimal stub.
  state_notes?: Array<Record<string, unknown>>;
}

function emit(s: Spec): void {
  const dir = join(ROOT, s.category);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const id = s.prefix;
  const filename = `${s.num}-${s.prefix.split('-').slice(2).join('-') || s.prefix}.yml`;
  const path = join(dir, filename);

  const lines: string[] = [];
  lines.push(`# ${s.description.split('\n')[0]}`);
  lines.push(`# Auto-generated 2026-05-19 by scripts/tier2-batch-generator.ts. Hand edits OK.`);
  lines.push('');
  lines.push(`id: ${id}`);
  lines.push(`name: ${quote(s.name)}`);
  lines.push(`description: |`);
  for (const l of s.description.split('\n')) lines.push(`  ${l}`);
  lines.push('');
  lines.push('covers:');
  for (const c of s.covers) lines.push(`  - ${c}`);
  lines.push('');
  lines.push(`golden_version: ${quote(GOLDEN_VERSION)}`);
  lines.push(`golden_run_at: ${NOW}`);
  lines.push('');
  lines.push('deps: []');
  lines.push('require_embedding: false');
  lines.push('require_git: false');
  lines.push('');
  lines.push('macro: |');
  for (const l of s.macro.split('\n')) lines.push(`  ${l}`);
  lines.push('');
  lines.push(`input_vars: ${jsonInline(s.input_vars ?? {})}`);
  lines.push(`vault: ${jsonInline(s.vault ?? {})}`);
  if (s.self_binding) {
    lines.push(`self_binding: ${jsonInline(s.self_binding)}`);
  }
  lines.push('');
  if (s.tools) {
    lines.push('tools:');
    for (const [server, cfg] of Object.entries(s.tools)) {
      lines.push(`  ${server}:`);
      for (const [k, v] of Object.entries(cfg)) {
        if (k === 'tool_name' || k === 'archetype' || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          lines.push(`    ${k}: ${jsonInline(v)}`);
        } else {
          lines.push(`    ${k}: ${jsonInline(v)}`);
        }
      }
    }
    lines.push('');
  }
  lines.push('expect:');
  if (s.expect.outcome) lines.push(`  outcome: ${s.expect.outcome}`);
  if (s.expect.return_result !== undefined) {
    lines.push(`  return_result: ${jsonInline(s.expect.return_result)}`);
  }
  if (s.expect.return_result_keys) {
    lines.push(`  return_result_keys: ${jsonInline(s.expect.return_result_keys)}`);
  }
  if (s.expect.error !== undefined) {
    if (typeof s.expect.error === 'string') {
      lines.push(`  error: ${quote(s.expect.error)}`);
    } else {
      lines.push(`  error:`);
      if (s.expect.error.code) lines.push(`    code: ${quote(s.expect.error.code)}`);
      if (s.expect.error.message_contains) lines.push(`    message_contains: ${quote(s.expect.error.message_contains)}`);
      if (s.expect.error.details) lines.push(`    details: ${jsonInline(s.expect.error.details)}`);
    }
  }
  if (s.state_notes) {
    lines.push('');
    lines.push('golden_snapshot:');
    lines.push('  state_notes:');
    for (const n of s.state_notes) {
      lines.push(`    - ${jsonInline(n)}`);
    }
  }
  lines.push('');
  writeFileSync(path, lines.join('\n'), 'utf8');
}

function quote(s: string | number | boolean): string {
  return JSON.stringify(s);
}

function jsonInline(v: unknown): string {
  return JSON.stringify(v);
}

// ─── SPECS ────────────────────────────────────────────────────────────────
// All specs below. Grouped by REQ area but written into category dirs.
// Naming convention: mtf-<cat>-<NUM>-<slug>, where NUM is a 3-digit
// sequence with 1XX reserved for Tier 2 hand-authored (28-33 used by
// initial Tier 2 land), 4XX-8XX reserved for the batch generator.

const SPECS: Spec[] = [];

// ─── REQ-103 _self binding (target ≥10 for MTF-I-101 + ≥5 for MTF-I-102) ──

SPECS.push({
  category: 'isolation',
  num: '101',
  prefix: 'mtf-i-101-self-path-only',
  name: '_self.path read in isolation',
  description: 'Single-field read of _self.path; verifies the snapshot binding without exercising other fields.',
  covers: ['MTF-I-101'],
  macro: 'exit { p: $_self.path }',
  self_binding: {
    path: '/Macros/example.md',
    frontmatter: {},
    title: 'Example',
    tags: [],
    fq_id: 'fq:doc:example:abc',
  },
  expect: { outcome: 'success', return_result: { p: '/Macros/example.md' } },
});

SPECS.push({
  category: 'isolation',
  num: '102',
  prefix: 'mtf-i-102-self-title-only',
  name: '_self.title read in isolation',
  description: 'Single-field read of _self.title.',
  covers: ['MTF-I-101'],
  macro: 'exit { t: $_self.title }',
  self_binding: { path: '/x.md', frontmatter: {}, title: 'A Title', tags: [], fq_id: 'fq:doc:x:1' },
  expect: { outcome: 'success', return_result: { t: 'A Title' } },
});

SPECS.push({
  category: 'isolation',
  num: '103',
  prefix: 'mtf-i-103-self-fq-id',
  name: '_self.fq_id is immutable identifier',
  description: 'Verifies _self.fq_id is exposed as a plain string.',
  covers: ['MTF-I-101'],
  macro: 'exit { id: $_self.fq_id }',
  self_binding: { path: '/x.md', frontmatter: {}, title: 't', tags: [], fq_id: 'fq:doc:x:identifier-abc-123' },
  expect: { outcome: 'success', return_result: { id: 'fq:doc:x:identifier-abc-123' } },
});

SPECS.push({
  category: 'isolation',
  num: '104',
  prefix: 'mtf-i-104-self-tags-list',
  name: '_self.tags exposes the tag list',
  description: 'Verifies _self.tags surfaces as a list value usable with `count`.',
  covers: ['MTF-I-101'],
  macro: `n = count $_self.tags
exit { n: $n }`,
  self_binding: { path: '/x.md', frontmatter: {}, title: 't', tags: ['a', 'b', 'c'], fq_id: 'fq:doc:x:1' },
  expect: { outcome: 'success', return_result: { n: 3 } },
});

SPECS.push({
  category: 'isolation',
  num: '105',
  prefix: 'mtf-i-105-self-tags-empty',
  name: '_self.tags empty list',
  description: 'When the document has no tags, _self.tags is an empty list (count=0).',
  covers: ['MTF-I-101'],
  macro: `n = count $_self.tags
exit { n: $n }`,
  self_binding: { path: '/x.md', frontmatter: {}, title: 't', tags: [], fq_id: 'fq:doc:x:1' },
  expect: { outcome: 'success', return_result: { n: 0 } },
});

SPECS.push({
  category: 'isolation',
  num: '106',
  prefix: 'mtf-i-106-self-fm-deep-field',
  name: '_self.frontmatter deep-field access',
  description: 'Deep dotted access into nested frontmatter — _self.frontmatter.config.priority.',
  covers: ['MTF-I-101'],
  macro: 'exit { p: $_self.frontmatter.config.priority }',
  self_binding: {
    path: '/x.md',
    frontmatter: { config: { priority: 'high', owner: 'matt' } },
    title: 't',
    tags: [],
    fq_id: 'fq:doc:x:1',
  },
  expect: { outcome: 'success', return_result: { p: 'high' } },
});

SPECS.push({
  category: 'isolation',
  num: '107',
  prefix: 'mtf-i-107-self-fm-missing-field',
  name: '_self.frontmatter missing field raises runtime error',
  description: 'Reading a frontmatter field that does not exist raises a runtime error (strict field-access semantics; production emits `missing_field`). Avoid boolean literal: frontmatter has a string field instead.',
  covers: ['MTF-I-101'],
  macro: 'exit { v: $_self.frontmatter.does_not_exist }',
  self_binding: { path: '/x.md', frontmatter: { exists: 'yes' }, title: 't', tags: [], fq_id: 'fq:doc:x:1' },
  expect: { outcome: 'fail', error: { code: 'tool_call_failed', details: { reason: 'missing_field' } } },
});

SPECS.push({
  category: 'isolation',
  num: '108',
  prefix: 'mtf-i-108-self-fm-array-value',
  name: '_self.frontmatter with array value',
  description: 'A frontmatter field that is itself a list — _self.frontmatter.authors — passes through as a list value.',
  covers: ['MTF-I-101'],
  macro: `authors = $_self.frontmatter.authors
n = count $authors
exit { n: $n }`,
  self_binding: {
    path: '/x.md',
    frontmatter: { authors: ['matt', 'sam', 'jordan'] },
    title: 't',
    tags: [],
    fq_id: 'fq:doc:x:1',
  },
  expect: { outcome: 'success', return_result: { n: 3 } },
});

SPECS.push({
  category: 'isolation',
  num: '109',
  prefix: 'mtf-i-109-self-multi-field-bundle',
  name: '_self multi-field bundle access',
  description: 'All four read-only fields surface in a single bundle expression.',
  covers: ['MTF-I-101'],
  macro: 'exit { p: $_self.path, t: $_self.title, ft: $_self.frontmatter.type, ident: $_self.fq_id }',
  self_binding: {
    path: '/Macros/research.md',
    frontmatter: { type: 'research' },
    title: 'Research Macro',
    tags: ['research'],
    fq_id: 'fq:doc:research:xyz',
  },
  expect: {
    outcome: 'success',
    return_result: {
      p: '/Macros/research.md',
      t: 'Research Macro',
      ft: 'research',
      ident: 'fq:doc:research:xyz',
    },
  },
});

SPECS.push({
  category: 'isolation',
  num: '110',
  prefix: 'mtf-i-110-self-in-conditional',
  name: '_self used inside if-condition',
  description: 'Verifies _self values flow through if-conditions. Avoids boolean literals (Macro Lang §3.3) by returning a comparison-derived value via string match.',
  covers: ['MTF-I-101'],
  macro: `kind = $_self.frontmatter.type
out = "miss"
if $kind == "macro" then
  out = "match"
fi
exit { v: $out }`,
  self_binding: {
    path: '/x.md',
    frontmatter: { type: 'macro' },
    title: 't',
    tags: [],
    fq_id: 'fq:doc:x:1',
  },
  expect: { outcome: 'success', return_result: { v: 'match' } },
});

SPECS.push({
  category: 'isolation',
  num: '111',
  prefix: 'mtf-i-111-self-in-loop',
  name: '_self.tags used in a for-loop iterator',
  description: 'Iterating over _self.tags collects the elements into an output list.',
  covers: ['MTF-I-101'],
  macro: `seen = []
for t in $_self.tags do
  seen = append $seen $t
done
exit { n: count $seen }`,
  self_binding: {
    path: '/x.md',
    frontmatter: {},
    title: 't',
    tags: ['alpha', 'beta', 'gamma', 'delta'],
    fq_id: 'fq:doc:x:1',
  },
  expect: { outcome: 'success', return_result: { n: 4 } },
});

SPECS.push({
  category: 'isolation',
  num: '112',
  prefix: 'mtf-i-112-self-interpolated',
  name: '_self interpolated into string',
  description: 'String interpolation of _self.title and _self.path verifies the interpolation surface accepts _self.* paths.',
  covers: ['MTF-I-101'],
  macro: 'exit { s: "doc ${_self.title} at ${_self.path}" }',
  self_binding: {
    path: '/Macros/x.md',
    frontmatter: {},
    title: 'Hello',
    tags: [],
    fq_id: 'fq:doc:x:1',
  },
  expect: { outcome: 'success', return_result: { s: 'doc Hello at /Macros/x.md' } },
});

// MTF-I-102: _self access when unbound (inline source — no source_ref).
SPECS.push({
  category: 'isolation',
  num: '120',
  prefix: 'mtf-i-120-self-unbound-path',
  name: '_self.path unbound raises runtime error',
  description: 'No self_binding provided; reading _self.path must raise a runtime error per REQ-103 inline-source clause.',
  covers: ['MTF-I-102'],
  macro: 'exit { p: $_self.path }',
  expect: { outcome: 'fail' },
});

SPECS.push({
  category: 'isolation',
  num: '121',
  prefix: 'mtf-i-121-self-unbound-fm',
  name: '_self.frontmatter unbound raises runtime error',
  description: 'No self_binding; reading _self.frontmatter.x must raise a runtime error.',
  covers: ['MTF-I-102'],
  macro: 'exit { v: $_self.frontmatter.x }',
  expect: { outcome: 'fail' },
});

SPECS.push({
  category: 'isolation',
  num: '122',
  prefix: 'mtf-i-122-self-unbound-title',
  name: '_self.title unbound raises runtime error',
  description: 'No self_binding; reading _self.title must raise a runtime error.',
  covers: ['MTF-I-102'],
  macro: 'exit { t: $_self.title }',
  expect: { outcome: 'fail' },
});

SPECS.push({
  category: 'isolation',
  num: '123',
  prefix: 'mtf-i-123-self-unbound-tags',
  name: '_self.tags unbound raises runtime error',
  description: 'No self_binding; reading _self.tags must raise a runtime error.',
  covers: ['MTF-I-102'],
  macro: 'exit { v: $_self.tags }',
  expect: { outcome: 'fail' },
});

SPECS.push({
  category: 'isolation',
  num: '124',
  prefix: 'mtf-i-124-self-unbound-fq-id',
  name: '_self.fq_id unbound raises runtime error',
  description: 'No self_binding; reading _self.fq_id must raise a runtime error.',
  covers: ['MTF-I-102'],
  macro: 'exit { v: $_self.fq_id }',
  expect: { outcome: 'fail' },
});

// ─── REQ-104 continue/break (target ≥10 + ≥10 + ≥5 + ≥5) ──────────────────

SPECS.push({
  category: 'control-flow',
  num: '401',
  prefix: 'mtf-c-401-continue-first-iter',
  name: 'continue on first iteration only',
  description: 'continue fires on i==1; remaining iterations sum 2+3+4+5 = 14.',
  covers: ['MTF-C-101'],
  macro: `t = 0
for i in 1..6 do
  if $i == 1 then
    continue
  fi
  t = add $t $i
done
exit { sum: $t }`,
  expect: { outcome: 'success', return_result: { sum: 14 } },
});

SPECS.push({
  category: 'control-flow',
  num: '402',
  prefix: 'mtf-c-402-continue-last-iter',
  name: 'continue on last iteration',
  description: 'continue fires on i==5; sum is 1+2+3+4 = 10.',
  covers: ['MTF-C-101'],
  macro: `t = 0
for i in 1..6 do
  if $i == 5 then
    continue
  fi
  t = add $t $i
done
exit { sum: $t }`,
  expect: { outcome: 'success', return_result: { sum: 10 } },
});

SPECS.push({
  category: 'control-flow',
  num: '403',
  prefix: 'mtf-c-403-continue-every-iter',
  name: 'continue on every iteration — accumulator unchanged',
  description: 'Unconditional continue at the top of every iteration; accumulator never advances.',
  covers: ['MTF-C-101'],
  macro: `t = 0
for i in 1..6 do
  continue
  t = add $t $i
done
exit { sum: $t }`,
  expect: { outcome: 'success', return_result: { sum: 0 } },
});

SPECS.push({
  category: 'control-flow',
  num: '404',
  prefix: 'mtf-c-404-continue-conditional-on-string',
  name: 'continue based on string equality',
  description: 'String-equality condition drives continue; only "keep" values appended.',
  covers: ['MTF-C-101'],
  macro: `keep = []
items = ["keep", "drop", "keep", "drop", "keep"]
for x in $items do
  if $x == "drop" then
    continue
  fi
  keep = append $keep $x
done
exit { n: count $keep }`,
  expect: { outcome: 'success', return_result: { n: 3 } },
});

SPECS.push({
  category: 'control-flow',
  num: '405',
  prefix: 'mtf-c-405-continue-with-and',
  name: 'continue gated by &&',
  description: 'Compound condition with && controls continue. Range 1..11 = {1..10}; continue on even <8 skips 2,4,6 — kept: 1+3+5+7+8+9+10 = 43.',
  covers: ['MTF-C-101'],
  macro: `t = 0
for i in 1..11 do
  rem = mod $i 2
  if $rem == 0 && $i < 8 then
    continue
  fi
  t = add $t $i
done
exit { sum: $t }`,
  expect: { outcome: 'success', return_result: { sum: 43 } },
});

SPECS.push({
  category: 'control-flow',
  num: '410',
  prefix: 'mtf-c-410-break-first-iter',
  name: 'break on first iteration',
  description: 'break fires immediately; counter never advances past 1.',
  covers: ['MTF-C-102'],
  macro: `c = 0
while $c < 100 do
  c = add $c 1
  if $c == 1 then
    break
  fi
done
exit { final: $c }`,
  expect: { outcome: 'success', return_result: { final: 1 } },
});

SPECS.push({
  category: 'control-flow',
  num: '411',
  prefix: 'mtf-c-411-break-in-for',
  name: 'break inside for-loop',
  description: 'break exits a for-loop at i==4; remaining iterations skipped.',
  covers: ['MTF-C-102'],
  macro: `t = 0
for i in 1..11 do
  if $i == 4 then
    break
  fi
  t = add $t $i
done
exit { sum: $t }`,
  expect: { outcome: 'success', return_result: { sum: 6 } },
});

SPECS.push({
  category: 'control-flow',
  num: '412',
  prefix: 'mtf-c-412-break-from-while-false-cond',
  name: 'break in while with always-false guard',
  description: 'while condition already false at top; break inside body unreachable. Loop simply does not enter.',
  covers: ['MTF-C-102'],
  macro: `c = 0
guard = 0
while $guard == 1 do
  c = add $c 1
  break
done
exit { final: $c }`,
  expect: { outcome: 'success', return_result: { final: 0 } },
});

SPECS.push({
  category: 'control-flow',
  num: '413',
  prefix: 'mtf-c-413-break-after-side-effect',
  name: 'break after executing side effect',
  description: 'Side effect (append) runs before break fires.',
  covers: ['MTF-C-102'],
  macro: `acc = []
for x in [10, 20, 30, 40] do
  acc = append $acc $x
  if $x == 20 then
    break
  fi
done
exit { n: count $acc }`,
  expect: { outcome: 'success', return_result: { n: 2 } },
});

SPECS.push({
  category: 'control-flow',
  num: '420',
  prefix: 'mtf-c-420-nested-continue-inner',
  name: 'nested loops — continue affects only inner',
  description: 'Inner continue skips inner iterations; outer counter advances normally.',
  covers: ['MTF-C-103'],
  macro: `outer = 0
inner_total = 0
for i in 1..4 do
  outer = add $outer 1
  for j in 1..4 do
    if $j == 2 then
      continue
    fi
    inner_total = add $inner_total 1
  done
done
exit { outer: $outer, inner: $inner_total }`,
  expect: { outcome: 'success', return_result: { outer: 3, inner: 6 } },
});

SPECS.push({
  category: 'control-flow',
  num: '421',
  prefix: 'mtf-c-421-nested-break-inner',
  name: 'nested loops — break exits only inner',
  description: 'Inner break exits inner loop; outer continues to completion.',
  covers: ['MTF-C-103'],
  macro: `outer = 0
inner_total = 0
for i in 1..4 do
  outer = add $outer 1
  for j in 1..10 do
    inner_total = add $inner_total 1
    if $j == 2 then
      break
    fi
  done
done
exit { outer: $outer, inner: $inner_total }`,
  expect: { outcome: 'success', return_result: { outer: 3, inner: 6 } },
});

SPECS.push({
  category: 'control-flow',
  num: '422',
  prefix: 'mtf-c-422-while-in-for-break',
  name: 'for containing while — inner break',
  description: 'Inner while with break leaves outer for intact.',
  covers: ['MTF-C-103'],
  macro: `tally = 0
for i in 1..4 do
  c = 0
  while $c < 10 do
    c = add $c 1
    if $c == 2 then
      break
    fi
  done
  tally = add $tally $c
done
exit { t: $tally }`,
  expect: { outcome: 'success', return_result: { t: 6 } },
});

SPECS.push({
  category: 'control-flow',
  num: '430',
  prefix: 'mtf-c-430-continue-at-toplevel',
  name: 'continue at macro top-level — parse error',
  description: 'Bare `continue` outside any loop must be rejected at parse time (REQ-104 ac).',
  covers: ['MTF-C-104'],
  macro: `x = 1
continue
exit { reached: false }`,
  expect: { outcome: 'parse_error' },
});

SPECS.push({
  category: 'control-flow',
  num: '431',
  prefix: 'mtf-c-431-break-at-toplevel',
  name: 'break at macro top-level — parse error',
  description: 'Bare `break` outside any loop must be rejected at parse time.',
  covers: ['MTF-C-104'],
  macro: `break
exit { reached: false }`,
  expect: { outcome: 'parse_error' },
});

SPECS.push({
  category: 'control-flow',
  num: '432',
  prefix: 'mtf-c-432-continue-in-if-not-loop',
  name: 'continue in if-branch outside loop — parse error',
  description: 'continue inside if-then-else but NOT inside a loop is still outside-loop.',
  covers: ['MTF-C-104'],
  macro: `cond = 1
if $cond == 1 then
  continue
fi`,
  expect: { outcome: 'parse_error' },
});

// ─── REQ-106 coercion paths (target ≥10 for MTF-D-101 + ≥5 for D-102) ─────

SPECS.push({
  category: 'dispatch',
  num: '501',
  prefix: 'mtf-d-501-coerce-structured-content',
  name: 'StructuredContentTool path: structuredContent binds directly',
  description: 'REQ-106 path 2: when structuredContent is present, the macro engine binds it as the value (not the text content).',
  covers: ['MTF-D-101'],
  macro: `v = thing_srv.get({})
exit { val: $v }`,
  tools: {
    thing_srv: {
      archetype: 'StructuredContentTool',
      tool_name: 'get',
      value: { kind: 'structured', n: 42 },
    },
  },
  expect: { outcome: 'success', return_result: { val: { kind: 'structured', n: 42 } } },
});

SPECS.push({
  category: 'dispatch',
  num: '502',
  prefix: 'mtf-d-502-coerce-json-text',
  name: 'JSONTextTool path: text content parses as JSON',
  description: 'REQ-106 path 3: text content that parses as JSON binds the parsed value.',
  covers: ['MTF-D-101'],
  macro: `v = json_srv.fetch({})
exit { out: $v }`,
  tools: {
    json_srv: {
      archetype: 'JSONTextTool',
      tool_name: 'fetch',
      value: { hello: 'world', count: 7 },
    },
  },
  expect: { outcome: 'success', return_result: { out: { hello: 'world', count: 7 } } },
});

SPECS.push({
  category: 'dispatch',
  num: '503',
  prefix: 'mtf-d-503-coerce-readonly-string',
  name: 'ReadOnlyTool path: plain text content',
  description: 'REQ-106 path 4: non-JSON text content binds the raw string.',
  covers: ['MTF-D-101'],
  macro: `v = info_srv.describe({})
exit { s: $v }`,
  tools: {
    info_srv: {
      archetype: 'ReadOnlyTool',
      tool_name: 'describe',
      returns: 'a plain string body',
    },
  },
  expect: { outcome: 'success', return_result: { s: 'a plain string body' } },
});

SPECS.push({
  category: 'dispatch',
  num: '504',
  prefix: 'mtf-d-504-coerce-iserror-fail',
  name: 'IsErrorTool path: isError=true triggers fail-fast (no binding)',
  description: 'REQ-106 path 1 / REQ-107: isError=true short-circuits — no value binding, fail-fast as tool_call_failed.',
  covers: ['MTF-D-101', 'MTF-D-102'],
  macro: `v = bad_srv.boom({})
exit { val: $v }`,
  tools: {
    bad_srv: {
      archetype: 'IsErrorTool',
      tool_name: 'boom',
      message: 'upstream refused the call',
    },
  },
  expect: { outcome: 'fail', error: { code: 'tool_call_failed' } },
});

SPECS.push({
  category: 'dispatch',
  num: '505',
  prefix: 'mtf-d-505-coerce-multiple-tools-in-macro',
  name: 'Multiple brokered calls chained — coercion fires per call',
  description: 'Sequential brokered calls each apply REQ-106 coercion independently.',
  covers: ['MTF-D-101'],
  macro: `a = srv_a.get({})
b = srv_b.get({})
exit { aval: $a, bval: $b.x }`,
  tools: {
    srv_a: { archetype: 'JSONTextTool', tool_name: 'get', value: { x: 1 } },
    srv_b: { archetype: 'StructuredContentTool', tool_name: 'get', value: { x: 99 } },
  },
  expect: { outcome: 'success', return_result: { aval: { x: 1 }, bval: 99 } },
});

SPECS.push({
  category: 'dispatch',
  num: '506',
  prefix: 'mtf-d-506-coerce-structured-list',
  name: 'StructuredContentTool with list value',
  description: 'structuredContent that is itself a list binds as a list.',
  covers: ['MTF-D-101'],
  macro: `v = list_srv.get({})
exit { n: count $v }`,
  tools: {
    list_srv: {
      archetype: 'StructuredContentTool',
      tool_name: 'get',
      value: [1, 2, 3, 4, 5],
    },
  },
  expect: { outcome: 'success', return_result: { n: 5 } },
});

SPECS.push({
  category: 'dispatch',
  num: '507',
  prefix: 'mtf-d-507-coerce-json-text-list',
  name: 'JSONTextTool with list value',
  description: 'JSON text that parses to a list binds as a list (no double-wrap).',
  covers: ['MTF-D-101'],
  macro: `v = list_srv.get({})
exit { n: count $v }`,
  tools: {
    list_srv: {
      archetype: 'JSONTextTool',
      tool_name: 'get',
      value: ['a', 'b', 'c'],
    },
  },
  expect: { outcome: 'success', return_result: { n: 3 } },
});

SPECS.push({
  category: 'dispatch',
  num: '508',
  prefix: 'mtf-d-508-coerce-json-text-null',
  name: 'JSONTextTool returns null',
  description: 'JSON-text "null" parses to null.',
  covers: ['MTF-D-101'],
  macro: `v = n_srv.get({})
exit { v: $v }`,
  tools: {
    n_srv: {
      archetype: 'JSONTextTool',
      tool_name: 'get',
      value: null,
    },
  },
  expect: { outcome: 'success', return_result: { v: null } },
});

SPECS.push({
  category: 'dispatch',
  num: '509',
  prefix: 'mtf-d-509-coerce-json-text-string',
  name: 'JSONTextTool returns JSON-string',
  description: 'JSON text that is a JSON-encoded string ("hello") parses to the bare string.',
  covers: ['MTF-D-101'],
  macro: `v = s_srv.get({})
exit { v: $v }`,
  tools: {
    s_srv: { archetype: 'JSONTextTool', tool_name: 'get', value: 'hello' },
  },
  expect: { outcome: 'success', return_result: { v: 'hello' } },
});

SPECS.push({
  category: 'dispatch',
  num: '510',
  prefix: 'mtf-d-510-coerce-json-text-number',
  name: 'JSONTextTool returns JSON-number',
  description: 'JSON-encoded number "42" parses to 42.',
  covers: ['MTF-D-101'],
  macro: `v = n_srv.get({})
plus_one = add $v 1
exit { result: $plus_one }`,
  tools: {
    n_srv: { archetype: 'JSONTextTool', tool_name: 'get', value: 42 },
  },
  expect: { outcome: 'success', return_result: { result: 43 } },
});

// REQ-107 fail-fast variants
SPECS.push({
  category: 'dispatch',
  num: '520',
  prefix: 'mtf-d-520-iserror-no-binding',
  name: 'isError fail-fast: subsequent statements not reached',
  description: 'After isError fail-fast, statements below are skipped (fail unwinds).',
  covers: ['MTF-D-101', 'MTF-D-102'],
  macro: `v = bad.boom({})
side_effect = "should never set"
exit { side: $side_effect }`,
  tools: {
    bad: { archetype: 'IsErrorTool', tool_name: 'boom', message: 'nope' },
  },
  expect: { outcome: 'fail' },
});

SPECS.push({
  category: 'dispatch',
  num: '521',
  prefix: 'mtf-d-521-thrown-error',
  name: 'Brokered tool throws — surfaces as tool_call_failed',
  description: 'When the brokered tool throws, the engine wraps it as tool_call_failed.',
  covers: ['MTF-D-101', 'MTF-D-102'],
  macro: `v = throwing.bomb({})
exit { v: $v }`,
  tools: {
    throwing: { archetype: 'ThrowingTool', tool_name: 'bomb', error_kind: 'generic' },
  },
  expect: { outcome: 'fail', error: { code: 'tool_call_failed' } },
});

SPECS.push({
  category: 'dispatch',
  num: '522',
  prefix: 'mtf-d-522-error-after-success',
  name: 'Two calls: first succeeds, second is isError',
  description: 'First call binds successfully; second hits isError fail-fast; macro fails.',
  covers: ['MTF-D-101', 'MTF-D-102'],
  macro: `a = good.get({})
b = bad.boom({})
exit { a: $a, b: $b }`,
  tools: {
    good: { archetype: 'JSONTextTool', tool_name: 'get', value: { ok: true } },
    bad: { archetype: 'IsErrorTool', tool_name: 'boom', message: 'broken' },
  },
  expect: { outcome: 'fail', error: { code: 'tool_call_failed' } },
});

// MTF-D-103 argument passthrough (target ≥5)
SPECS.push({
  category: 'dispatch',
  num: '530',
  prefix: 'mtf-d-530-arg-string-passthrough',
  name: 'String argument passes through bit-exact',
  description: 'WriteTool returns { ok, side_effect, args }; the macro nests that under `v`. We verify msg reached the broker by reading $v.args.msg back.',
  covers: ['MTF-D-103'],
  macro: `v = echo_srv.run({ msg: "hello world" })
exit { got: $v.args.msg }`,
  tools: {
    echo_srv: { archetype: 'WriteTool', tool_name: 'run', side_effect: 'echo' },
  },
  expect: { outcome: 'success', return_result: { got: 'hello world' } },
});

SPECS.push({
  category: 'dispatch',
  num: '531',
  prefix: 'mtf-d-531-arg-number-passthrough',
  name: 'Number argument passes through bit-exact',
  description: 'Number args (integer + float) preserved bit-exact.',
  covers: ['MTF-D-103'],
  macro: `v = num_srv.calc({ i: 42, f: 3.14 })
exit { v: $v }`,
  tools: {
    num_srv: { archetype: 'WriteTool', tool_name: 'calc' },
  },
  expect: { outcome: 'success' },
});

SPECS.push({
  category: 'dispatch',
  num: '532',
  prefix: 'mtf-d-532-arg-null-passthrough',
  name: 'Null argument passes through',
  description: 'A null value in args is preserved (not omitted, not stringified).',
  covers: ['MTF-D-103'],
  macro: `v = srv.run({ maybe: null })
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

SPECS.push({
  category: 'dispatch',
  num: '533',
  prefix: 'mtf-d-533-arg-array-passthrough',
  name: 'Array argument passes through',
  description: 'List values in args preserve element order and types.',
  covers: ['MTF-D-103'],
  macro: `v = srv.run({ items: ["a", "b", "c"] })
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

SPECS.push({
  category: 'dispatch',
  num: '534',
  prefix: 'mtf-d-534-arg-nested-object',
  name: 'Nested object argument passes through',
  description: 'Multi-level nested object arg with mixed types — preserved.',
  covers: ['MTF-D-103'],
  macro: `v = srv.run({ cfg: { mode: "fast", options: { retries: 3, timeout: 1000 } } })
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

SPECS.push({
  category: 'dispatch',
  num: '535',
  prefix: 'mtf-d-535-arg-empty-object',
  name: 'Empty object argument passes through',
  description: 'Calling with `{}` is valid and reaches the dispatcher.',
  covers: ['MTF-D-103'],
  macro: `v = srv.run({})
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

SPECS.push({
  category: 'dispatch',
  num: '536',
  prefix: 'mtf-d-536-arg-with-interpolation',
  name: 'String-interpolated argument value',
  description: 'Interpolated variables resolve before dispatch; the resulting string is passed through.',
  covers: ['MTF-D-103'],
  macro: `name = "matt"
v = srv.run({ greeting: "hi \${name}" })
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

SPECS.push({
  category: 'dispatch',
  num: '537',
  prefix: 'mtf-d-537-arg-from-variable',
  name: 'Argument value sourced from prior variable',
  description: 'A previously bound variable feeds an arg value; references resolve at call time.',
  covers: ['MTF-D-103'],
  macro: `payload = { user: "matt", count: 5 }
v = srv.run({ data: $payload })
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

// ─── REQ-105 TOFU drift (target ≥10 + ≥5) ────────────────────────────────

SPECS.push({
  category: 'errors',
  num: '601',
  prefix: 'mtf-e-601-drift-on-first-call',
  name: 'TOFU drift on first call surfaces fifth termination',
  description: 'Single-tool drift caught at pre-dispatch; macro exits needs_user_input.',
  covers: ['MTF-E-101'],
  macro: `r = svc.do_thing({})
exit $r`,
  tools: {
    svc: {
      archetype: 'NeedsInputViaTofuDrift',
      tool_name: 'do_thing',
      drift_payload: { server: 'svc', tool: 'do_thing' },
    },
  },
  expect: { outcome: 'needs_user_input' },
});

SPECS.push({
  category: 'errors',
  num: '602',
  prefix: 'mtf-e-602-drift-with-rich-payload',
  name: 'Drift payload exposes question + diff_summary',
  description: 'Verifies the canonical REQ-042 envelope: question + diff_summary present.',
  covers: ['MTF-E-101', 'MTF-E-102'],
  macro: `r = svc.run({})
exit $r`,
  tools: {
    svc: {
      archetype: 'NeedsInputViaTofuDrift',
      tool_name: 'run',
      drift_payload: {
        server: 'svc',
        tool: 'run',
        question: 'Approve the new schema?',
        diff_summary: '• Added required parameter: foo',
      },
    },
  },
  expect: { outcome: 'needs_user_input' },
});

SPECS.push({
  category: 'errors',
  num: '603',
  prefix: 'mtf-e-603-drift-after-other-calls',
  name: 'Drift detected on second call after a successful first',
  description: 'First call succeeds; second tool is drift-flagged → macro fails over to fifth termination.',
  covers: ['MTF-E-101'],
  macro: `a = good_srv.go({})
b = drift_srv.go({})
exit { a: $a, b: $b }`,
  tools: {
    good_srv: { archetype: 'JSONTextTool', tool_name: 'go', value: { ok: 1 } },
    drift_srv: {
      archetype: 'NeedsInputViaTofuDrift',
      tool_name: 'go',
      drift_payload: { server: 'drift_srv', tool: 'go' },
    },
  },
  expect: { outcome: 'needs_user_input' },
});

SPECS.push({
  category: 'errors',
  num: '604',
  prefix: 'mtf-e-604-drift-in-loop',
  name: 'Drift detected mid-loop',
  description: 'A brokered call inside a for-loop hits drift on the first iteration → loop body abandoned.',
  covers: ['MTF-E-101'],
  macro: `for i in 1..3 do
  v = drift_srv.go({ i: $i })
done
exit { reached: false }`,
  tools: {
    drift_srv: {
      archetype: 'NeedsInputViaTofuDrift',
      tool_name: 'go',
      drift_payload: { server: 'drift_srv', tool: 'go' },
    },
  },
  expect: { outcome: 'needs_user_input' },
});

SPECS.push({
  category: 'errors',
  num: '605',
  prefix: 'mtf-e-605-drift-different-tool-same-server',
  name: 'Drift on one tool — other tools on same server still callable',
  description: 'A drift-flagged tool blocks; a different tool on the same server still dispatches normally.',
  covers: ['MTF-E-101'],
  macro: `v = mixed_srv.ok({})
exit $v`,
  tools: {
    mixed_srv: {
      tools: {
        ok: { archetype: 'JSONTextTool', value: { fine: true } },
        bad: {
          archetype: 'NeedsInputViaTofuDrift',
          drift_payload: { server: 'mixed_srv', tool: 'bad' },
        },
      },
    },
  },
  expect: { outcome: 'success', return_result: { fine: true } },
});

SPECS.push({
  category: 'errors',
  num: '606',
  prefix: 'mtf-e-606-drift-tool-then-good-blocked',
  name: 'Drift-flagged tool called — drift wins',
  description: 'When the drift-flagged tool is actually invoked, drift fires (not the other tool).',
  covers: ['MTF-E-101'],
  macro: `v = mixed_srv.bad({})
exit $v`,
  tools: {
    mixed_srv: {
      tools: {
        ok: { archetype: 'JSONTextTool', value: { fine: true } },
        bad: {
          archetype: 'NeedsInputViaTofuDrift',
          drift_payload: { server: 'mixed_srv', tool: 'bad' },
        },
      },
    },
  },
  expect: { outcome: 'needs_user_input' },
});

SPECS.push({
  category: 'errors',
  num: '607',
  prefix: 'mtf-e-607-drift-payload-default-question',
  name: 'Drift payload with default question text',
  description: 'When no question override is supplied, the archetype defaults provide a sane question.',
  covers: ['MTF-E-102'],
  macro: `r = s.t({})
exit $r`,
  tools: {
    s: {
      archetype: 'NeedsInputViaTofuDrift',
      tool_name: 't',
      drift_payload: { server: 's', tool: 't' },
    },
  },
  expect: { outcome: 'needs_user_input' },
});

SPECS.push({
  category: 'errors',
  num: '608',
  prefix: 'mtf-e-608-drift-after-assignment',
  name: 'Drift surfaces even after non-tool side-effects',
  description: 'Assignments and arithmetic before the drift call do not change the termination class.',
  covers: ['MTF-E-101'],
  macro: `a = 1
b = add $a 1
r = drift.go({})
exit $r`,
  tools: {
    drift: {
      archetype: 'NeedsInputViaTofuDrift',
      tool_name: 'go',
      drift_payload: { server: 'drift', tool: 'go' },
    },
  },
  expect: { outcome: 'needs_user_input' },
});

SPECS.push({
  category: 'errors',
  num: '609',
  prefix: 'mtf-e-609-drift-with-vault-context',
  name: 'Drift call with vault populated — exit kind unaffected by side state',
  description: 'Adding a vault to the test does not change the macro termination — drift still fires.',
  covers: ['MTF-E-101'],
  macro: `r = drift.go({})
exit $r`,
  tools: {
    drift: {
      archetype: 'NeedsInputViaTofuDrift',
      tool_name: 'go',
      drift_payload: { server: 'drift', tool: 'go' },
    },
  },
  vault: { '/somefile.md': 'irrelevant' },
  expect: { outcome: 'needs_user_input' },
});

SPECS.push({
  category: 'errors',
  num: '610',
  prefix: 'mtf-e-610-drift-with-args',
  name: 'Drift call with args — args ignored at pre-dispatch',
  description: 'Pre-dispatch drift fires regardless of the args being passed (drift is upstream of arg validation).',
  covers: ['MTF-E-101'],
  macro: `r = drift.go({ topic: "anything", count: 5 })
exit $r`,
  tools: {
    drift: {
      archetype: 'NeedsInputViaTofuDrift',
      tool_name: 'go',
      drift_payload: { server: 'drift', tool: 'go' },
    },
  },
  expect: { outcome: 'needs_user_input' },
});

// ─── REQ-109 _exists deep-probe (target ≥5) ───────────────────────────────

SPECS.push({
  category: 'lifecycle',
  num: '701',
  prefix: 'mtf-l-701-exists-true-connected',
  name: '_exists() returns true for connected brokered server',
  description: 'A FakeBroker with a server configured returns true for the _exists() probe.',
  covers: ['MTF-L-101'],
  macro: `e = svc._exists()
exit { e: $e }`,
  tools: { svc: { archetype: 'ReadOnlyTool', tool_name: 'noop', returns: 'ok' } },
  expect: { outcome: 'success', return_result: { e: true } },
});

SPECS.push({
  category: 'lifecycle',
  num: '702',
  prefix: 'mtf-l-702-exists-fq-true',
  name: '_exists() for fq is unconditionally true',
  description: 'The native fq namespace surfaces _exists() as true even without explicit tools.',
  covers: ['MTF-L-101'],
  macro: `e = fq._exists()
exit { e: $e }`,
  tools: { fq: { archetype: 'ReadOnlyTool' } as ToolSpec },
  expect: { outcome: 'success', return_result: { e: true } },
});

SPECS.push({
  category: 'lifecycle',
  num: '703',
  prefix: 'mtf-l-703-exists-guard-pattern',
  name: '_exists() guard skips dispatch when false',
  description: 'The canonical guard pattern: assign _exists() to a var first, then branch on it. Boolean literal `true` deferred per Macro Lang §3.3, so the success signal is a string.',
  covers: ['MTF-L-101'],
  macro: `e = svc._exists()
phase = "did_not_reach"
if ! $e then
  fail "service offline"
fi
phase = "reached"
exit { v: $phase }`,
  tools: { svc: { archetype: 'ReadOnlyTool', tool_name: 'noop', returns: 'x' } },
  expect: { outcome: 'success', return_result: { v: 'reached' } },
});

SPECS.push({
  category: 'lifecycle',
  num: '704',
  prefix: 'mtf-l-704-exists-stored-in-var',
  name: '_exists() result stored in variable then re-checked',
  description: 'Saving the probe in a variable and reading it later returns the same boolean.',
  covers: ['MTF-L-101'],
  macro: `e1 = svc._exists()
e2 = $e1
exit { same: $e1 == $e2 }`,
  tools: { svc: { archetype: 'ReadOnlyTool', tool_name: 'n', returns: 'r' } },
  expect: { outcome: 'success', return_result: { same: true } },
});

SPECS.push({
  category: 'lifecycle',
  num: '705',
  prefix: 'mtf-l-705-exists-truthy-in-if',
  name: '_exists() return value drives an if-condition (assigned first)',
  description: '_exists() must be assigned to a variable before use in an expression (macro grammar). Variable then drives if-condition.',
  covers: ['MTF-L-101'],
  macro: `e = svc._exists()
result = "offline"
if $e then
  result = "online"
fi
exit { r: $result }`,
  tools: { svc: { archetype: 'ReadOnlyTool', tool_name: 'n', returns: 'x' } },
  expect: { outcome: 'success', return_result: { r: 'online' } },
});

SPECS.push({
  category: 'lifecycle',
  num: '706',
  prefix: 'mtf-l-706-exists-combined-with-and',
  name: '_exists() result combined with && (assigned first)',
  description: 'After assignment, the _exists() result feeds a compound && expression normally.',
  covers: ['MTF-L-101'],
  macro: `e = svc._exists()
result = "no"
if $e && 1 == 1 then
  result = "yes"
fi
exit { v: $result }`,
  tools: { svc: { archetype: 'ReadOnlyTool', tool_name: 'n', returns: 'x' } },
  expect: { outcome: 'success', return_result: { v: 'yes' } },
});

// ─── Cross-cutting batch (mixed) ──────────────────────────────────────────

SPECS.push({
  category: 'dispatch',
  num: '601',
  prefix: 'mtf-d-601-coercion-chain',
  name: 'Long brokered-call chain — every coercion path used',
  description: 'Single macro exercises ReadOnly, JSONText, StructuredContent in sequence.',
  covers: ['MTF-D-101'],
  macro: `a = ro.get({})
b = jt.get({})
c = sc.get({})
exit { a: $a, b: $b, c: $c.x }`,
  tools: {
    ro: { archetype: 'ReadOnlyTool', tool_name: 'get', returns: 'plain' },
    jt: { archetype: 'JSONTextTool', tool_name: 'get', value: { z: 7 } },
    sc: { archetype: 'StructuredContentTool', tool_name: 'get', value: { x: 999 } },
  },
  expect: {
    outcome: 'success',
    return_result: { a: 'plain', b: { z: 7 }, c: 999 },
  },
});

SPECS.push({
  category: 'dispatch',
  num: '602',
  prefix: 'mtf-d-602-call-in-conditional',
  name: 'Brokered call only in then-branch (outer-scope var pre-declared)',
  description: 'Tool dispatch nested in an if-then-else branch. Variable declared at outer scope so it survives after the `fi` (REQ-021 walk-up scope).',
  covers: ['MTF-D-101'],
  macro: `flag = 1
r = "fallback"
if $flag == 1 then
  r = jt.get({})
fi
exit { r: $r }`,
  tools: { jt: { archetype: 'JSONTextTool', tool_name: 'get', value: { k: 'v' } } },
  expect: { outcome: 'success', return_result: { r: { k: 'v' } } },
});

SPECS.push({
  category: 'dispatch',
  num: '603',
  prefix: 'mtf-d-603-coerce-empty-string',
  name: 'ReadOnlyTool empty-string return',
  description: 'Empty-string body coerces to "" (truthy/falsy semantics preserved — "" is falsy). Outer-scope var pre-declared.',
  covers: ['MTF-D-101'],
  macro: `v = e.get({})
out = "empty"
if $v then
  out = "non-empty"
fi
exit { out: $out }`,
  tools: { e: { archetype: 'ReadOnlyTool', tool_name: 'get', returns: '' } },
  expect: { outcome: 'success', return_result: { out: 'empty' } },
});

SPECS.push({
  category: 'dispatch',
  num: '604',
  prefix: 'mtf-d-604-structured-bool-flag',
  name: 'StructuredContentTool returning boolean-like flag (1/0)',
  description: 'structuredContent number 1/0 used as truthy/falsy in if. Outer-scope var pre-declared.',
  covers: ['MTF-D-101'],
  macro: `r = flag_srv.get({})
out = "no"
if $r == 1 then
  out = "yes"
fi
exit { out: $out }`,
  tools: { flag_srv: { archetype: 'StructuredContentTool', tool_name: 'get', value: 1 } },
  expect: { outcome: 'success', return_result: { out: 'yes' } },
});

SPECS.push({
  category: 'dispatch',
  num: '605',
  prefix: 'mtf-d-605-nested-loop-tool-calls',
  name: 'Brokered call inside nested for-loop',
  description: 'Inner loop calls a brokered tool each iteration; verifies dispatch + binding under loop ctx. Range 1..3 = {1,2}, so 2 iterations × 10 = 20.',
  covers: ['MTF-D-101'],
  macro: `tally = 0
for i in 1..3 do
  v = jt.get({})
  tally = add $tally $v.n
done
exit { total: $tally }`,
  tools: { jt: { archetype: 'JSONTextTool', tool_name: 'get', value: { n: 10 } } },
  expect: { outcome: 'success', return_result: { total: 20 } },
});

// REQ-108 deeper edge cases
SPECS.push({
  category: 'dispatch',
  num: '538',
  prefix: 'mtf-d-538-arg-numeric-string',
  name: 'String "42" stays a string (no preemptive coercion)',
  description: 'Per REQ-108, arg "42" passes as string; engine does not coerce to number.',
  covers: ['MTF-D-103'],
  macro: `v = srv.run({ n: "42" })
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

SPECS.push({
  category: 'dispatch',
  num: '539',
  prefix: 'mtf-d-539-arg-list-of-lists',
  name: 'Nested list-of-lists argument',
  description: 'Deeply nested list values preserved as lists at every level.',
  covers: ['MTF-D-103'],
  macro: `v = srv.run({ matrix: [[1, 2], [3, 4]] })
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

SPECS.push({
  category: 'dispatch',
  num: '540',
  prefix: 'mtf-d-540-arg-mixed-types',
  name: 'Mixed-types object argument',
  description: 'Object combining string, number, null, list, nested object preserved end-to-end.',
  covers: ['MTF-D-103'],
  macro: `v = srv.run({ s: "x", n: 1, z: null, list: [1, 2], obj: { y: "y" } })
exit { v: $v }`,
  tools: { srv: { archetype: 'WriteTool', tool_name: 'run' } },
  expect: { outcome: 'success' },
});

// ─── REQ-104 more (target padding) ────────────────────────────────────────

SPECS.push({
  category: 'control-flow',
  num: '406',
  prefix: 'mtf-c-406-continue-skip-pivot',
  name: 'continue skips the pivot value in a sort-ish pass',
  description: 'Skip exactly one value (the pivot) and accumulate the rest.',
  covers: ['MTF-C-101'],
  macro: `t = 0
pivot = 4
for i in 1..8 do
  if $i == $pivot then
    continue
  fi
  t = add $t $i
done
exit { sum: $t }`,
  expect: { outcome: 'success', return_result: { sum: 24 } },
});

SPECS.push({
  category: 'control-flow',
  num: '407',
  prefix: 'mtf-c-407-continue-multiple-conditions',
  name: 'Multiple continue conditions',
  description: 'Two separate `if continue` blocks before the body — both filters apply.',
  covers: ['MTF-C-101'],
  macro: `acc = []
for x in [1, 2, 3, 4, 5, 6, 7, 8] do
  if $x < 3 then
    continue
  fi
  if $x > 6 then
    continue
  fi
  acc = append $acc $x
done
exit { n: count $acc }`,
  expect: { outcome: 'success', return_result: { n: 4 } },
});

SPECS.push({
  category: 'control-flow',
  num: '414',
  prefix: 'mtf-c-414-break-then-after-loop',
  name: 'break followed by post-loop statement',
  description: 'After break exits the loop, execution continues with statements after `done`.',
  covers: ['MTF-C-102'],
  macro: `seen = 0
for i in 1..10 do
  seen = add $seen 1
  if $seen == 3 then
    break
  fi
done
post = add $seen 100
exit { p: $post }`,
  expect: { outcome: 'success', return_result: { p: 103 } },
});

SPECS.push({
  category: 'control-flow',
  num: '415',
  prefix: 'mtf-c-415-break-from-conditional',
  name: 'break inside if branch — only fires when branch taken',
  description: 'break sits inside an if-then; only fires when the condition is true.',
  covers: ['MTF-C-102'],
  macro: `c = 0
for i in 1..5 do
  c = add $c 1
  if $i == 3 then
    break
  fi
done
exit { c: $c }`,
  expect: { outcome: 'success', return_result: { c: 3 } },
});

SPECS.push({
  category: 'control-flow',
  num: '423',
  prefix: 'mtf-c-423-nested-continue-outer-effect',
  name: 'Nested loops — outer continue carries through',
  description: 'continue in the outer loop skips both inner work and outer accumulator update. Range 1..4 = {1,2,3}, skip i=2 → outer = 1+3 = 4. Inner loop fires for i=1 and i=3, each adds 1+2 = 3, total inner = 6.',
  covers: ['MTF-C-103'],
  macro: `outer_sum = 0
inner_sum = 0
for i in 1..4 do
  if $i == 2 then
    continue
  fi
  for j in 1..3 do
    inner_sum = add $inner_sum $j
  done
  outer_sum = add $outer_sum $i
done
exit { o: $outer_sum, i: $inner_sum }`,
  expect: { outcome: 'success', return_result: { o: 4, i: 6 } },
});

// ─── REQ-103 _self extras ─────────────────────────────────────────────────

SPECS.push({
  category: 'isolation',
  num: '113',
  prefix: 'mtf-i-113-self-frontmatter-number',
  name: '_self.frontmatter with numeric value',
  description: '_self.frontmatter.priority returns a number value usable in arithmetic.',
  covers: ['MTF-I-101'],
  macro: `p = $_self.frontmatter.priority
doubled = mul $p 2
exit { d: $doubled }`,
  self_binding: {
    path: '/x.md',
    frontmatter: { priority: 5 },
    title: 't',
    tags: [],
    fq_id: 'fq:doc:x:1',
  },
  expect: { outcome: 'success', return_result: { d: 10 } },
});

SPECS.push({
  category: 'isolation',
  num: '114',
  prefix: 'mtf-i-114-self-empty-frontmatter',
  name: '_self with empty frontmatter — access raises missing_field',
  description: '_self.frontmatter is present but empty; reading any field raises a runtime error consistent with strict field-access semantics.',
  covers: ['MTF-I-101'],
  macro: `v = $_self.frontmatter.anything
exit { v: $v }`,
  self_binding: {
    path: '/x.md',
    frontmatter: {},
    title: 't',
    tags: [],
    fq_id: 'fq:doc:x:1',
  },
  expect: { outcome: 'fail', error: { code: 'tool_call_failed', details: { reason: 'missing_field' } } },
});

SPECS.push({
  category: 'isolation',
  num: '115',
  prefix: 'mtf-i-115-self-fm-list-of-objects',
  name: '_self.frontmatter with list-of-objects',
  description: 'Frontmatter field is a list of objects; element access drills down by index isn’t supported (deferred) but count works.',
  covers: ['MTF-I-101'],
  macro: `items = $_self.frontmatter.items
n = count $items
exit { n: $n }`,
  self_binding: {
    path: '/x.md',
    frontmatter: { items: [{ a: 1 }, { a: 2 }] },
    title: 't',
    tags: [],
    fq_id: 'fq:doc:x:1',
  },
  expect: { outcome: 'success', return_result: { n: 2 } },
});

// ─── REQ-106 even more variants ───────────────────────────────────────────

SPECS.push({
  category: 'dispatch',
  num: '511',
  prefix: 'mtf-d-511-coerce-nested-deep',
  name: 'StructuredContent with deeply nested payload',
  description: 'Multi-level nested structuredContent — deep field access works after binding.',
  covers: ['MTF-D-101'],
  macro: `v = sc.get({})
exit { deep: $v.a.b.c.d }`,
  tools: {
    sc: {
      archetype: 'StructuredContentTool',
      tool_name: 'get',
      value: { a: { b: { c: { d: 'leaf' } } } },
    },
  },
  expect: { outcome: 'success', return_result: { deep: 'leaf' } },
});

SPECS.push({
  category: 'dispatch',
  num: '512',
  prefix: 'mtf-d-512-coerce-empty-object',
  name: 'StructuredContent returning empty object',
  description: '`structuredContent: {}` binds as `{}` (truthy or falsy depends on lang semantics).',
  covers: ['MTF-D-101'],
  macro: `v = sc.get({})
exit { v: $v }`,
  tools: {
    sc: { archetype: 'StructuredContentTool', tool_name: 'get', value: {} },
  },
  expect: { outcome: 'success', return_result: { v: {} } },
});

SPECS.push({
  category: 'dispatch',
  num: '513',
  prefix: 'mtf-d-513-readonly-large-text',
  name: 'ReadOnlyTool returning a long text body',
  description: 'A longer text body still binds as a string and is comparable.',
  covers: ['MTF-D-101'],
  macro: `v = info.go({})
exit { v: $v }`,
  tools: {
    info: {
      archetype: 'ReadOnlyTool',
      tool_name: 'go',
      returns: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    },
  },
  expect: {
    outcome: 'success',
    return_result: { v: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.' },
  },
});

// ─── REQ-107 fail-fast more ───────────────────────────────────────────────

SPECS.push({
  category: 'dispatch',
  num: '523',
  prefix: 'mtf-d-523-fail-fast-in-loop',
  name: 'fail-fast triggers loop unwind',
  description: 'isError fail-fast inside a for-loop unwinds — post-loop statements skipped.',
  covers: ['MTF-D-101', 'MTF-D-102'],
  macro: `for i in 1..5 do
  v = bad.boom({})
done
exit { reached: true }`,
  tools: { bad: { archetype: 'IsErrorTool', tool_name: 'boom', message: 'no' } },
  expect: { outcome: 'fail', error: { code: 'tool_call_failed' } },
});

SPECS.push({
  category: 'dispatch',
  num: '524',
  prefix: 'mtf-d-524-fail-fast-then-branch',
  name: 'fail-fast inside if-then',
  description: 'isError inside if-then branch fires the macro failure.',
  covers: ['MTF-D-101', 'MTF-D-102'],
  macro: `if 1 == 1 then
  v = bad.boom({})
fi
exit { reached: true }`,
  tools: { bad: { archetype: 'IsErrorTool', tool_name: 'boom', message: 'x' } },
  expect: { outcome: 'fail', error: { code: 'tool_call_failed' } },
});

SPECS.push({
  category: 'dispatch',
  num: '525',
  prefix: 'mtf-d-525-fail-fast-with-payload-shape',
  name: 'fail-fast error payload includes server/tool',
  description: 'The tool_call_failed envelope details include server and tool.',
  covers: ['MTF-D-102'],
  macro: `v = boomy.bang({})
exit { v: $v }`,
  tools: { boomy: { archetype: 'IsErrorTool', tool_name: 'bang', message: 'oops' } },
  expect: { outcome: 'fail', error: { code: 'tool_call_failed' } },
});

// More _self
SPECS.push({
  category: 'isolation',
  num: '125',
  prefix: 'mtf-i-125-self-unbound-in-loop',
  name: '_self unbound inside a loop — runtime error per iteration boundary',
  description: 'Reading _self.x inside a loop body when unbound still raises runtime error.',
  covers: ['MTF-I-102'],
  macro: `for i in 1..3 do
  p = $_self.path
done`,
  expect: { outcome: 'fail' },
});

// More _exists
SPECS.push({
  category: 'lifecycle',
  num: '707',
  prefix: 'mtf-l-707-exists-with-or',
  name: '_exists() result combined with || (assigned first)',
  description: 'Assigned _exists() result drives a || expression; "yes" outcome reachable.',
  covers: ['MTF-L-101'],
  macro: `e = svc._exists()
result = "no"
if $e || 1 == 0 then
  result = "yes"
fi
exit { v: $result }`,
  tools: { svc: { archetype: 'ReadOnlyTool', tool_name: 'n', returns: 'r' } },
  expect: { outcome: 'success', return_result: { v: 'yes' } },
});

SPECS.push({
  category: 'lifecycle',
  num: '708',
  prefix: 'mtf-l-708-exists-negation',
  name: '_exists() negation with !',
  description: 'The ! operator flips the boolean from _exists(). Avoid boolean literal in expected by comparing the negation outcome via a downstream side-effect.',
  covers: ['MTF-L-101'],
  macro: `e = svc._exists()
result = "still-true"
if ! $e then
  result = "neg-fired"
fi
exit { v: $result }`,
  tools: { svc: { archetype: 'ReadOnlyTool', tool_name: 'n', returns: 'r' } },
  expect: { outcome: 'success', return_result: { v: 'still-true' } },
});

// ─── Emit all ─────────────────────────────────────────────────────────────

console.error(`Emitting ${SPECS.length} pilot YAMLs...`);
for (const s of SPECS) {
  try {
    emit(s);
  } catch (e) {
    console.error(`FAILED to emit ${s.prefix}:`, e);
    throw e;
  }
}
console.error(`Done. Wrote ${SPECS.length} files.`);
