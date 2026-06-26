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
  temporal_markers_contains?: string[];
  external_refs_contains?: string[];
  // Additional axes (close the coverage matrix).
  chunk_summary_nonempty?: boolean;
  chunk_summary_max_sentences?: number;
  /** true = provenance_basis must be non-null; false = must be null. */
  provenance_present?: boolean;
  provenance_basis?: string | null;
  provenance_basis_contains?: string[];
  /** true = question_resolution must be non-null; false = must be null. */
  question_resolution_present?: boolean;
  question_resolution_contains?: string[];
  external_refs_empty?: boolean;
  temporal_markers_empty?: boolean;
  /** true = the model must have emitted a non-empty reasoning field (use with --reasoning). */
  reasoning_present?: boolean;
  reasoning_max_sentences?: number;
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
  /** A valid edge must set metadata.low_confidence_flag = true (hedged/weak link). */
  require_low_confidence_flag?: boolean;
  /** The primary (highest-confidence valid) edge's confidence must be >= this. */
  confidence_min?: number;
  /** The primary edge's confidence must be <= this (for hedged/weak links). */
  confidence_max?: number;
  /** Judge the primary edge's natural-language `reasoning` against these criteria
   *  (e.g. [grounded, justifies]) using the source/target claims as the reference. */
  judge_reasoning?: string[];
  /** The primary edge's natural-language reasoning should stay brief. */
  reasoning_max_sentences?: number;
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

/** Per-field LLM-as-judge spec inside a record case (one judge call per field). */
export interface JudgeSpec {
  /** Named rubric criteria (defaults per field if omitted — see judge.DEFAULT_CRITERIA). */
  criteria?: string[];
  /** Specific facts the field's value must include/represent (judged as captures[...]). */
  must_capture?: string[];
}

/**
 * Full-record case (README §14). One production-faithful input → run the real op ONCE →
 * verify EVERY field of the resulting JSON: enum/choice/structural fields via expected-vs-actual
 * (reusing NodeExpect / EdgeExpect), natural-language fields via per-field LLM-as-judge (`judge`).
 * A coverage guard hard-fails the case if any output field has neither an `expect` nor a `judge`
 * entry nor an explicit `structural_only` waiver — so nothing is silently unchecked.
 */
export interface RecordCase {
  kind: 'record';
  /** Which production op to exercise. */
  op: 'node' | 'edge';
  name: string;
  file: string;
  description?: string;
  /** INFO-ONLY: whether the input text is hand-written (synthetic) or lifted from a real external
   *  source (web research, docs, etc.). Does not affect scoring — captured so runs can be sliced by
   *  input provenance later (e.g. "how does the model do on real vs. synthetic text?"). */
  input_source?: 'synthetic' | 'external';
  /** INFO-ONLY: optional note on where external input came from (URL, doc name). */
  source_note?: string;
  /** node op input (the chunk text). */
  input?: string;
  /** edge op inputs. */
  source?: CaseSide;
  target?: CaseSide;
  /** Enum / choice / structural expectations (same keys as the node/edge facet cases). */
  expect: NodeExpect & EdgeExpect;
  /** Per-NL-field judge specs. Node fields: key_claims, chunk_summary, reasoning,
   *  question_resolution. Edge field: reasoning. */
  judge?: Record<string, JudgeSpec>;
  /** Output fields deliberately NOT value-checked (e.g. analyzed_content_hash, claim-ref arrays).
   *  Listing a field here satisfies the coverage guard intentionally rather than by omission. */
  structural_only?: string[];
  /** Per-case graph-model override (defaults to the run's --model). */
  model?: string;
  /** Per-case judge-model override (defaults to the run's --judge-model, else the graph model). */
  judge_model?: string;
  /** Run the case N times (cache bypassed) and require ALL runs to fully pass — samples
   *  run-to-run variance for the "every single run" guarantee. Default 1. */
  repeat?: number;
}

export type GraphCase = NodeCase | EdgeCase | NlCase | RecordCase;

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
    } else if (kind === 'record') {
      const op = raw.op;
      if (op !== 'node' && op !== 'edge')
        throw new Error(`Case ${file}: kind 'record' requires op: node | edge (got ${JSON.stringify(op)})`);
      if (op === 'node' && (raw.input === undefined || String(raw.input).trim() === ''))
        throw new Error(`Case ${file}: record/node requires non-empty 'input'`);
      if (op === 'edge' && (!raw.source || !raw.target))
        throw new Error(`Case ${file}: record/edge requires 'source' and 'target'`);
      const inputSource = raw.input_source as string | undefined;
      if (inputSource !== undefined && inputSource !== 'synthetic' && inputSource !== 'external')
        throw new Error(`Case ${file}: input_source must be 'synthetic' or 'external' (got ${JSON.stringify(inputSource)})`);
      cases.push({
        kind: 'record',
        op,
        name,
        file,
        description: raw.description as string,
        input_source: inputSource as 'synthetic' | 'external' | undefined,
        source_note: raw.source_note as string | undefined,
        input: raw.input !== undefined ? String(raw.input) : undefined,
        source: raw.source as CaseSide | undefined,
        target: raw.target as CaseSide | undefined,
        expect: (raw.expect ?? {}) as NodeExpect & EdgeExpect,
        judge: raw.judge as Record<string, JudgeSpec> | undefined,
        structural_only: raw.structural_only as string[] | undefined,
        model: raw.model as string | undefined,
        judge_model: raw.judge_model as string | undefined,
        repeat: raw.repeat as number | undefined,
      });
    } else {
      throw new Error(`Case ${file}: missing or unknown 'kind' (expected node|edge|nl|record)`);
    }
  }
  return cases;
}
