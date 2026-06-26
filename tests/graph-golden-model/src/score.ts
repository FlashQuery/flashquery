// Three-layer scoring: parse (valid JSON), schema (passes strict Zod), and
// semantic (content matches the fixture's expectations). Keeping the layers
// separate is what makes a failing run diagnosable — "the model can't produce
// our JSON shape" is a different problem from "it picked the wrong relation".

import type { EdgeCase, NlCase, NodeCase, RecordCase } from './cases.ts';
import type { EdgeOpResult } from './edge-op.ts';
import type { NodeOpResult } from './node-op.ts';
import type { NlOpResult } from './nl-op.ts';
import type { RecordJudgeField, RecordOpResult } from './record-op.ts';

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface Scored {
  name: string;
  description?: string;
  parseOk: boolean;
  schemaOk: boolean;
  checks: Check[];
  passed: number;
  total: number;
}

export interface ScoredEdge extends Scored {
  expectedPrimary?: string;
  /** Highest-confidence valid relation the model produced (for the matrix). */
  predictedPrimary?: string;
}

function includesCI(haystack: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  return haystack.some((h) => h.toLowerCase().includes(n));
}

function includesTextCI(haystack: string | null | undefined, needle: string): boolean {
  return String(haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

function sentenceCount(text: string | null | undefined): number {
  const normalized = String(text ?? '').trim();
  if (!normalized) return 0;
  const matches = normalized.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [];
  return matches.map((s) => s.trim()).filter(Boolean).length;
}

export function scoreNode(testCase: NodeCase, result: NodeOpResult): Scored {
  const parseOk = result.parse.ok || result.parse.failure === 'schema';
  const schemaOk = result.parse.ok;
  const checks: Check[] = [];
  const a = testCase.expect ?? {};
  const p = result.payload;

  if (schemaOk && p) {
    if (a.certainty_level !== undefined)
      checks.push(eq('certainty_level', p.certainty_level, a.certainty_level));
    if (a.certainty_level_in !== undefined)
      checks.push(oneOf('certainty_level', p.certainty_level, a.certainty_level_in));
    if (a.staleness_risk !== undefined)
      checks.push(eq('staleness_risk', p.staleness_risk, a.staleness_risk));
    if (a.staleness_risk_in !== undefined)
      checks.push(oneOf('staleness_risk', p.staleness_risk, a.staleness_risk_in));
    if (a.question_status !== undefined)
      checks.push(eq('question_status', p.question_status, a.question_status));
    if (a.question_status_in !== undefined)
      checks.push(oneOf('question_status', p.question_status, a.question_status_in));
    if (a.key_claims_min !== undefined)
      checks.push(min('key_claims_min', p.key_claims.length, a.key_claims_min));
    for (const needle of a.key_claims_contains ?? [])
      checks.push({
        name: `key_claims contains "${needle}"`,
        pass: includesCI(p.key_claims, needle),
      });
    if (a.temporal_markers_min !== undefined)
      checks.push(min('temporal_markers_min', p.temporal_markers.length, a.temporal_markers_min));
    for (const needle of a.temporal_markers_contains ?? [])
      checks.push({
        name: `temporal_markers contains "${needle}"`,
        pass: includesCI(p.temporal_markers, needle),
        detail: `got ${JSON.stringify(p.temporal_markers)}`,
      });
    for (const needle of a.external_refs_contains ?? [])
      checks.push({
        name: `external_refs contains "${needle}"`,
        pass: includesCI(p.external_refs, needle),
      });
    if (a.chunk_summary_nonempty)
      checks.push({ name: 'chunk_summary non-empty', pass: p.chunk_summary.trim().length > 0 });
    if (a.chunk_summary_max_sentences !== undefined)
      checks.push(max('chunk_summary sentence count', sentenceCount(p.chunk_summary), a.chunk_summary_max_sentences));
    if (a.provenance_present !== undefined)
      checks.push({
        name: `provenance_basis ${a.provenance_present ? 'present' : 'null'}`,
        pass: (p.provenance_basis !== null) === a.provenance_present,
        detail: `got ${JSON.stringify(p.provenance_basis)}`,
      });
    if (a.provenance_basis !== undefined)
      checks.push(eq('provenance_basis', p.provenance_basis, a.provenance_basis));
    for (const needle of a.provenance_basis_contains ?? [])
      checks.push({
        name: `provenance_basis contains "${needle}"`,
        pass: includesTextCI(p.provenance_basis, needle),
        detail: `got ${JSON.stringify(p.provenance_basis)}`,
      });
    if (a.question_resolution_present !== undefined)
      checks.push({
        name: `question_resolution ${a.question_resolution_present ? 'present' : 'null'}`,
        pass: (p.question_resolution !== null) === a.question_resolution_present,
        detail: `got ${JSON.stringify(p.question_resolution)}`,
      });
    for (const needle of a.question_resolution_contains ?? [])
      checks.push({
        name: `question_resolution contains "${needle}"`,
        pass: includesTextCI(p.question_resolution, needle),
        detail: `got ${JSON.stringify(p.question_resolution)}`,
      });
    if (a.external_refs_empty)
      checks.push({
        name: 'external_refs empty',
        pass: p.external_refs.length === 0,
        detail: `got ${p.external_refs.length}`,
      });
    if (a.temporal_markers_empty)
      checks.push({
        name: 'temporal_markers empty',
        pass: p.temporal_markers.length === 0,
        detail: `got ${p.temporal_markers.length}`,
      });
    if (a.reasoning_present)
      checks.push({
        name: 'reasoning present',
        pass: typeof p.reasoning === 'string' && p.reasoning.trim().length > 0,
      });
    if (a.reasoning_max_sentences !== undefined)
      checks.push(max('reasoning sentence count', sentenceCount(p.reasoning), a.reasoning_max_sentences));
  }

  return finalize(testCase.name, testCase.description, parseOk, schemaOk, checks);
}

export function scoreEdge(testCase: EdgeCase, result: EdgeOpResult): ScoredEdge {
  const parseOk = result.parse.ok || result.parse.failure === 'schema';
  const schemaOk = result.parse.ok;
  const checks: Check[] = [];
  const e = testCase.expect;
  const validEdges = result.edges.filter((edge) => edge.valid);
  const validRelations = validEdges.map((edge) => edge.relation);
  const primaryEdge = [...validEdges].sort((x, y) => y.confidenceScore - x.confidenceScore)[0];

  if (schemaOk) {
    if (result.edges.length > 0)
      checks.push({
        name: 'all returned edges pass real validation',
        pass: result.edges.every((edge) => edge.valid),
        detail: result.edges
          .filter((edge) => !edge.valid)
          .map((edge) => `${edge.relation}: ${edge.validationError}`)
          .join('; ') || undefined,
      });
    for (const rel of e.expect_relations ?? [])
      checks.push({ name: `produces "${rel}"`, pass: validRelations.includes(rel) });
    for (const rel of e.forbid_relations ?? [])
      checks.push({ name: `avoids "${rel}"`, pass: !validRelations.includes(rel) });
    if (e.primary_relation_in !== undefined)
      checks.push(oneOf('primary_relation', primaryEdge?.relation, e.primary_relation_in));
    if (e.min_edges !== undefined)
      checks.push(min('min_edges (valid)', validEdges.length, e.min_edges));
    if (e.max_edges !== undefined)
      checks.push({
        name: `max_edges (valid) <= ${e.max_edges}`,
        pass: validEdges.length <= e.max_edges,
        detail: `got ${validEdges.length}`,
      });
    if (e.llm_assessment_in !== undefined)
      checks.push({
        name: `an edge's llm_assessment in ${JSON.stringify(e.llm_assessment_in)}`,
        pass: validEdges.some((edge) => e.llm_assessment_in!.includes(String(edge.llmAssessment))),
        detail: `got ${JSON.stringify(validEdges.map((edge) => edge.llmAssessment))}`,
      });
    if (e.require_qualifier !== undefined)
      checks.push({
        name: `an edge carries a ${e.require_qualifier} qualifier`,
        pass: validEdges.some((edge) => edge.qualifierKinds.includes(e.require_qualifier!)),
        detail: `got ${JSON.stringify(validEdges.map((edge) => edge.qualifierKinds))}`,
      });
    if (e.require_low_confidence_flag)
      checks.push({
        name: 'an edge sets low_confidence_flag',
        pass: validEdges.some((edge) => edge.lowConfidenceFlag === true),
        detail: `got ${JSON.stringify(validEdges.map((edge) => edge.lowConfidenceFlag))}`,
      });
    if (e.confidence_min !== undefined)
      checks.push({
        name: `primary confidence >= ${e.confidence_min}`,
        pass: (primaryEdge?.confidenceScore ?? 0) >= e.confidence_min,
        detail: `got ${primaryEdge?.confidenceScore}`,
      });
    if (e.confidence_max !== undefined)
      checks.push({
        name: `primary confidence <= ${e.confidence_max}`,
        pass: primaryEdge ? primaryEdge.confidenceScore <= e.confidence_max : false,
        detail: `got ${primaryEdge?.confidenceScore}`,
      });
    if (e.reasoning_max_sentences !== undefined)
      checks.push({
        name: `primary reasoning sentence count <= ${e.reasoning_max_sentences}`,
        pass: primaryEdge ? sentenceCount(primaryEdge.reasoning) <= e.reasoning_max_sentences : false,
        detail: primaryEdge ? `got ${sentenceCount(primaryEdge.reasoning)}` : 'no primary edge',
      });
  }

  const predictedPrimary = primaryEdge?.relation;
  return {
    ...finalize(testCase.name, testCase.description, parseOk, schemaOk, checks),
    expectedPrimary: e.primary_relation,
    predictedPrimary,
  };
}

export function scoreNl(c: NlCase, result: NlOpResult): Scored {
  const checks: Check[] = [];
  const expectFail = new Set((c.expect_fail ?? []).map((s) => s.toLowerCase()));

  if (result.extracted) {
    const extractionOk = result.extractParse?.ok === true && result.output !== undefined;
    checks.push({
      name: 'extraction produced the field',
      pass: extractionOk,
      detail: !extractionOk
        ? result.extractParse && !result.extractParse.ok
          ? result.extractParse.summary
          : 'field missing from payload'
        : undefined,
    });
  }

  // Precision bounds on extracted claim count (over/under-extraction control).
  if (Array.isArray(result.output)) {
    const count = result.output.length;
    if (c.max_claims !== undefined)
      checks.push({ name: `<= ${c.max_claims} claims`, pass: count <= c.max_claims, detail: `got ${count}` });
    if (c.min_claims !== undefined)
      checks.push({ name: `>= ${c.min_claims} claims`, pass: count >= c.min_claims, detail: `got ${count}` });
  }

  const judgeOk = result.judge.ok && !!result.judge.verdict;
  checks.push({ name: 'judge returned valid JSON', pass: judgeOk, detail: judgeOk ? undefined : result.judge.summary });

  if (judgeOk) {
    const verdicts = new Map(result.judge.verdict!.criteria.map((v) => [v.name.toLowerCase(), v]));
    for (const crit of result.criteria) {
      const v = verdicts.get(crit.name.toLowerCase());
      const expected = expectFail.has(crit.name.toLowerCase()) ? 'fail' : 'pass';
      // Normalize: anything that isn't exactly "pass" counts as fail (skeptical default).
      const got = v ? (v.verdict.trim().toLowerCase() === 'pass' ? 'pass' : 'fail') : undefined;
      checks.push({
        name: `${crit.name}: expect ${expected}`,
        pass: got === expected,
        detail: v ? `judge=${got} (${v.verdict})${v.reason ? ` — ${v.reason}` : ''}` : 'judge omitted this criterion',
      });
    }
  }

  return {
    name: c.name,
    description: c.description,
    parseOk: true, // NL uses explicit checks above rather than the node/edge parse-layer markers
    schemaOk: true,
    checks,
    passed: checks.filter((ck) => ck.pass).length,
    total: checks.length,
  };
}

// ── Full-record scoring (README §14) ─────────────────────────────────────────
// The coverage tables enumerate EVERY field the op outputs and, for each, which `expect` keys (or
// `judge` block) count as "an expectation present". The coverage guard fails the case if a field is
// covered by none of them and is not explicitly waived via `structural_only`. Keep these in sync
// with the production payload schemas (node: GraphNodeAnalysisPayloadSchema; edge: the edge draft).

interface FieldCoverage {
  expectKeys: string[];
  /** Key under the case's `judge:` block that also satisfies coverage for this field. */
  judgeKey?: string;
}

const NODE_FIELD_COVERAGE: Record<string, FieldCoverage> = {
  reasoning: { expectKeys: ['reasoning_present', 'reasoning_max_sentences'], judgeKey: 'reasoning' },
  key_claims: { expectKeys: ['key_claims_min', 'key_claims_contains'], judgeKey: 'key_claims' },
  chunk_summary: { expectKeys: ['chunk_summary_nonempty', 'chunk_summary_max_sentences'], judgeKey: 'chunk_summary' },
  provenance_basis: { expectKeys: ['provenance_present', 'provenance_basis', 'provenance_basis_contains'] },
  question_status: { expectKeys: ['question_status', 'question_status_in'] },
  question_resolution: { expectKeys: ['question_resolution_present', 'question_resolution_contains'], judgeKey: 'question_resolution' },
  certainty_level: { expectKeys: ['certainty_level', 'certainty_level_in'] },
  staleness_risk: { expectKeys: ['staleness_risk', 'staleness_risk_in'] },
  external_refs: { expectKeys: ['external_refs_contains', 'external_refs_empty'] },
  temporal_markers: { expectKeys: ['temporal_markers_min', 'temporal_markers_contains', 'temporal_markers_empty'] },
  // System-filled post-parse (fallbackContentHash); the model emits "". Always structural_only.
  analyzed_content_hash: { expectKeys: [] },
};

const EDGE_FIELD_COVERAGE: Record<string, FieldCoverage> = {
  relation: { expectKeys: ['primary_relation', 'primary_relation_in', 'expect_relations'] },
  reasoning: { expectKeys: ['reasoning_max_sentences'], judgeKey: 'reasoning' },
  confidence_score: { expectKeys: ['confidence_min', 'confidence_max'] },
  llm_assessment: { expectKeys: ['llm_assessment_in'] },
  qualifiers: { expectKeys: ['require_qualifier'] },
  low_confidence_flag: { expectKeys: ['require_low_confidence_flag'] },
  // Bounds-checked by the real validateGraphEdgeDraft path; not value-asserted. Structural_only.
  source_claims_referenced: { expectKeys: [] },
  target_claims_referenced: { expectKeys: [] },
};

function coverageChecks(c: RecordCase): Check[] {
  const table = c.op === 'node' ? NODE_FIELD_COVERAGE : EDGE_FIELD_COVERAGE;
  const waived = new Set(c.structural_only ?? []);
  const expect = c.expect as Record<string, unknown>;
  const judge = c.judge ?? {};
  const checks: Check[] = [];
  for (const [field, cov] of Object.entries(table)) {
    const byExpect = cov.expectKeys.some((k) => expect[k] !== undefined);
    const byJudge = cov.judgeKey ? judge[cov.judgeKey] !== undefined : false;
    const byWaiver = waived.has(field);
    const covered = byExpect || byJudge || byWaiver;
    checks.push({
      name: `coverage: ${field}`,
      pass: covered,
      detail: covered
        ? byWaiver
          ? 'structural-only (waived)'
          : byJudge
            ? 'judged'
            : 'asserted'
        : 'NO expectation — add to expect/judge or list in structural_only',
    });
  }
  return checks;
}

/** Score one judged NL field exactly like the nl scorer: JSON-valid + each criterion expects pass. */
function scoreJudgeField(jf: RecordJudgeField): Check[] {
  const checks: Check[] = [];
  const judgeOk = jf.judge.ok && !!jf.judge.verdict;
  checks.push({
    name: `judge[${jf.field}] returned valid JSON`,
    pass: judgeOk,
    detail: judgeOk ? undefined : jf.judge.summary,
  });
  if (judgeOk) {
    const vmap = new Map(jf.judge.verdict!.criteria.map((v) => [v.name.toLowerCase(), v]));
    for (const crit of jf.criteria) {
      const v = vmap.get(crit.name.toLowerCase());
      const got = v ? (v.verdict.trim().toLowerCase() === 'pass' ? 'pass' : 'fail') : undefined;
      checks.push({
        name: `${jf.field}.${crit.name}: expect pass`,
        pass: got === 'pass',
        detail: v ? `judge=${got}${v.reason ? ` — ${v.reason}` : ''}` : 'judge omitted this criterion',
      });
    }
  }
  return checks;
}

export function scoreRecord(c: RecordCase, result: RecordOpResult): ScoredEdge {
  let parseOk: boolean;
  let schemaOk: boolean;
  const semantic: Check[] = [];
  let expectedPrimary: string | undefined;
  let predictedPrimary: string | undefined;

  if (c.op === 'node') {
    const sn = scoreNode({ name: c.name, description: c.description, expect: c.expect } as NodeCase, result.node!);
    parseOk = sn.parseOk;
    schemaOk = sn.schemaOk;
    semantic.push(...sn.checks);
  } else {
    const se = scoreEdge({ name: c.name, description: c.description, expect: c.expect } as EdgeCase, result.edge!);
    parseOk = se.parseOk;
    schemaOk = se.schemaOk;
    semantic.push(...se.checks);
    expectedPrimary = se.expectedPrimary;
    predictedPrimary = se.predictedPrimary;
    // scoreEdge treats primary_relation as a display label only; the record asserts it for real.
    if (schemaOk && c.expect.primary_relation !== undefined)
      semantic.push(eq('primary_relation', result.primaryEdge?.relation, c.expect.primary_relation));
  }

  // The completeness guarantee + the per-field judges.
  semantic.push(...coverageChecks(c));
  for (const jf of result.judges) semantic.push(...scoreJudgeField(jf));

  return { ...finalize(c.name, c.description, parseOk, schemaOk, semantic), expectedPrimary, predictedPrimary };
}

function eq(name: string, actual: unknown, expected: unknown): Check {
  return { name: `${name} = ${JSON.stringify(expected)}`, pass: actual === expected, detail: `got ${JSON.stringify(actual)}` };
}

function oneOf(name: string, actual: unknown, accepted: string[]): Check {
  return {
    name: `${name} in ${JSON.stringify(accepted)}`,
    pass: accepted.includes(String(actual)),
    detail: `got ${JSON.stringify(actual)}`,
  };
}

function min(name: string, actual: number, expected: number): Check {
  return { name: `${name} >= ${expected}`, pass: actual >= expected, detail: `got ${actual}` };
}

function max(name: string, actual: number, expected: number): Check {
  return { name: `${name} <= ${expected}`, pass: actual <= expected, detail: `got ${actual}` };
}

function finalize(
  name: string,
  description: string | undefined,
  parseOk: boolean,
  schemaOk: boolean,
  checks: Check[]
): Scored {
  const layerChecks: Check[] = [
    { name: 'parse (valid JSON)', pass: parseOk },
    { name: 'schema (strict Zod)', pass: schemaOk },
  ];
  const all = [...layerChecks, ...checks];
  return {
    name,
    description,
    parseOk,
    schemaOk,
    checks,
    passed: all.filter((c) => c.pass).length,
    total: all.length,
  };
}
