// Three-layer scoring: parse (valid JSON), schema (passes strict Zod), and
// semantic (content matches the fixture's expectations). Keeping the layers
// separate is what makes a failing run diagnosable — "the model can't produce
// our JSON shape" is a different problem from "it picked the wrong relation".

import type { EdgeCase, NlCase, NodeCase } from './cases.ts';
import type { EdgeOpResult } from './edge-op.ts';
import type { NodeOpResult } from './node-op.ts';
import type { NlOpResult } from './nl-op.ts';

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
    for (const needle of a.external_refs_contains ?? [])
      checks.push({
        name: `external_refs contains "${needle}"`,
        pass: includesCI(p.external_refs, needle),
      });
    if (a.chunk_summary_nonempty)
      checks.push({ name: 'chunk_summary non-empty', pass: p.chunk_summary.trim().length > 0 });
    if (a.provenance_present !== undefined)
      checks.push({
        name: `provenance_basis ${a.provenance_present ? 'present' : 'null'}`,
        pass: (p.provenance_basis !== null) === a.provenance_present,
        detail: `got ${JSON.stringify(p.provenance_basis)}`,
      });
    if (a.question_resolution_present !== undefined)
      checks.push({
        name: `question_resolution ${a.question_resolution_present ? 'present' : 'null'}`,
        pass: (p.question_resolution !== null) === a.question_resolution_present,
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
    if (e.confidence_min !== undefined)
      checks.push({
        name: `primary confidence >= ${e.confidence_min}`,
        pass: (primaryEdge?.confidenceScore ?? 0) >= e.confidence_min,
        detail: `got ${primaryEdge?.confidenceScore}`,
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
