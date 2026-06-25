// Test cases live as one YAML file per case under cases/ — a flat regression
// directory you grow over time without touching any infrastructure here. Each
// file declares its `kind` (node | edge) and carries the input text(s) plus the
// expected categorizations / relationship.
//
// Node case:
//   kind: node
//   description: ...
//   input: |        # the chunk text
//     ...
//   expect: { certainty_level, staleness_risk, question_status,
//             key_claims_min, key_claims_contains, temporal_markers_min,
//             external_refs_contains }
//
// Edge case:
//   kind: edge
//   description: ...
//   source: { chunk_id, key_claims: [...] }   # or: { chunk_id, text: | ... }
//   target: { chunk_id, key_claims: [...] }   # or: { chunk_id, text: | ... }
//   expect: { primary_relation, expect_relations, forbid_relations,
//             min_edges, max_edges }
//
// When a side gives `text` instead of `key_claims`, the runner derives claims by
// running node analysis first (the chained pipeline) — matching how production
// feeds key_claims (not raw text) into edge classification.

import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, '..', 'cases');

export interface NodeExpect {
  certainty_level?: string;
  /** Accept any of these certainty values — for genuinely ambiguous chunks. */
  certainty_level_in?: string[];
  staleness_risk?: string;
  staleness_risk_in?: string[];
  question_status?: string | null;
  /** Accept any of these statuses — use for judgment-call cases (e.g. deferred vs resolved). */
  question_status_in?: string[];
  key_claims_min?: number;
  key_claims_contains?: string[];
  temporal_markers_min?: number;
  external_refs_contains?: string[];
  // Additional axes (close the coverage matrix).
  chunk_summary_nonempty?: boolean;
  /** true = provenance_basis must be non-null; false = must be null. */
  provenance_present?: boolean;
  /** true = question_resolution must be non-null; false = must be null. */
  question_resolution_present?: boolean;
  external_refs_empty?: boolean;
  temporal_markers_empty?: boolean;
  /** true = the model must have emitted a non-empty reasoning field (use with --reasoning). */
  reasoning_present?: boolean;
}

export interface EdgeExpect {
  primary_relation?: string;
  /** Accept any of these as the primary relation — for genuinely confusable pairs. */
  primary_relation_in?: string[];
  expect_relations?: string[];
  forbid_relations?: string[];
  min_edges?: number;
  max_edges?: number;
  /** A valid edge's llm_assessment must be one of these. */
  llm_assessment_in?: string[];
  /** At least one valid edge must carry a non-empty qualifier of this kind. */
  require_qualifier?: 'temporal' | 'conditional' | 'uncertainty';
  /** The primary (highest-confidence valid) edge's confidence must be >= this. */
  confidence_min?: number;
  /** Judge the primary edge's natural-language `reasoning` against these criteria
   *  (e.g. [grounded, justifies]) using the source/target claims as the reference. */
  judge_reasoning?: string[];
}

export interface CaseSide {
  chunk_id: string;
  key_claims?: string[];
  text?: string;
}

export interface NodeCase {
  kind: 'node';
  name: string;
  file: string;
  description?: string;
  input: string;
  expect: NodeExpect;
}

export interface EdgeCase {
  kind: 'edge';
  name: string;
  file: string;
  description?: string;
  source: CaseSide;
  target: CaseSide;
  expect: EdgeExpect;
}

export interface NlCase {
  kind: 'nl';
  name: string;
  file: string;
  description?: string;
  /** The source text the NL output is derived from. */
  input: string;
  /** Which NL output to judge. Extracted from node analysis unless `given` is set. */
  field: 'key_claims' | 'chunk_summary' | string;
  /** Named rubric criteria (default per field if omitted). */
  criteria?: string[];
  /** Specific facts the output must include/represent (judged). */
  must_capture?: string[];
  /** Judge a provided output instead of extracting — for negative controls / judge calibration. */
  given?: unknown;
  /** Criteria expected to FAIL (negative controls). Empty/absent ⇒ all expected to pass. */
  expect_fail?: string[];
  /** Precision bounds on extracted key_claims count (over/under-extraction control). */
  max_claims?: number;
  min_claims?: number;
  /** What the judge treats as the reference: the source text (default) or the model's own
   *  extracted key_claims (for cross-output consistency — e.g. summary vs claims). */
  against?: 'source' | 'key_claims';
}

export type GraphCase = NodeCase | EdgeCase | NlCase;

export function loadCases(only?: string): GraphCase[] {
  if (!fs.existsSync(CASES_DIR)) return [];
  const files = fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();
  const onlyTokens = only
    ? only.split(',').map((t) => t.trim()).filter(Boolean)
    : [];
  const cases: GraphCase[] = [];
  for (const file of files) {
    const name = file.replace(/\.ya?ml$/, '');
    if (onlyTokens.length && !onlyTokens.some((t) => name.includes(t))) continue;
    const raw = yaml.load(fs.readFileSync(join(CASES_DIR, file), 'utf-8')) as Record<string, unknown>;
    const kind = raw.kind;
    if (kind === 'node') {
      cases.push({ kind: 'node', name, file, description: raw.description as string, input: String(raw.input ?? ''), expect: (raw.expect ?? {}) as NodeExpect });
    } else if (kind === 'edge') {
      cases.push({ kind: 'edge', name, file, description: raw.description as string, source: raw.source as CaseSide, target: raw.target as CaseSide, expect: (raw.expect ?? {}) as EdgeExpect });
    } else if (kind === 'nl') {
      cases.push({
        kind: 'nl',
        name,
        file,
        description: raw.description as string,
        input: String(raw.input ?? ''),
        field: (raw.field as string) ?? 'key_claims',
        criteria: raw.criteria as string[] | undefined,
        must_capture: raw.must_capture as string[] | undefined,
        given: raw.given,
        expect_fail: raw.expect_fail as string[] | undefined,
        max_claims: raw.max_claims as number | undefined,
        min_claims: raw.min_claims as number | undefined,
        against: raw.against as 'source' | 'key_claims' | undefined,
      });
    } else {
      throw new Error(`Case ${file}: missing or unknown 'kind' (expected node|edge|nl)`);
    }
  }
  return cases;
}
