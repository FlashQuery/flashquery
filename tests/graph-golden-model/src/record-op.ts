// Full-record operation (README §14). Runs ONE production-faithful op call (analyze_node or
// classify_edge) using the GRAPH transport, then runs one LLM-as-judge call PER declared NL field
// using the JUDGE transport. Returns everything the record scorer needs to (a) check every enum/
// structural field, (b) check every NL field, and (c) prove via the coverage guard that no field
// was left unchecked.
//
// Extraction always uses the real ops (node-op / edge-op), so the parse/schema/validator path is
// identical to production. The judge is a TESTING tool layered on top, never a production prompt.

import type { CaseSide, RecordCase } from './cases.ts';
import type { Settings } from './config.ts';
import type { LlmTransport } from './llm-client.ts';
import { runNodeOp, type NodeOpResult, type ParseInfo } from './node-op.ts';
import { runEdgeOp, type EdgeOpResult, type ValidatedEdge } from './edge-op.ts';
import { resolveCriteria, runJudge, type JudgeCriterion, type JudgeResult } from './judge.ts';
import type { ChatMessage } from './llm-client.ts';
import type { ChunkRef } from './prompts.ts';

/** Result of judging ONE natural-language field of the record. */
export interface RecordJudgeField {
  field: string;
  output: unknown;
  criteria: JudgeCriterion[];
  judge: JudgeResult;
}

export interface RecordOpResult {
  op: 'node' | 'edge';
  model: string;
  judgeModel: string;
  mocked: boolean;
  latencyMs: number;
  /** The op prompt actually sent (for the report). */
  messages: ChatMessage[];
  raw: string;
  parse: ParseInfo;
  /** node op output. */
  node?: NodeOpResult;
  /** edge op output. */
  edge?: EdgeOpResult;
  /** Highest-confidence valid edge (the one whose fields the record asserts). */
  primaryEdge?: ValidatedEdge;
  derivedClaims?: { source?: string[]; target?: string[] };
  /** One entry per declared NL judge field. */
  judges: RecordJudgeField[];
}

/** Map a record/node judge field to the value to judge and the reference text. */
function nodeFieldValue(field: string, payload: Record<string, unknown> | undefined): unknown {
  return payload ? payload[field] : undefined;
}

async function resolveSide(
  side: CaseSide,
  graphTransport: LlmTransport,
  settings: Settings
): Promise<{ ref: ChunkRef; derived?: string[] }> {
  if (side.key_claims && side.key_claims.length > 0) {
    return { ref: { chunk_id: side.chunk_id, key_claims: side.key_claims } };
  }
  if (side.text) {
    const node = await runNodeOp({ content: side.text }, graphTransport, settings);
    const claims = node.payload?.key_claims ?? [];
    return { ref: { chunk_id: side.chunk_id, key_claims: claims }, derived: claims };
  }
  return { ref: { chunk_id: side.chunk_id, key_claims: [] } };
}

export async function runRecordOp(
  c: RecordCase,
  graphTransport: LlmTransport,
  judgeTransport: LlmTransport,
  settings: Settings,
  graphModel: string,
  judgeModel: string
): Promise<RecordOpResult> {
  const judges: RecordJudgeField[] = [];
  const judgeSpecs = c.judge ?? {};

  if (c.op === 'node') {
    const node = await runNodeOp({ content: c.input ?? '' }, graphTransport, settings);
    const payload = node.payload as Record<string, unknown> | undefined;
    for (const [field, spec] of Object.entries(judgeSpecs)) {
      const value = nodeFieldValue(field, payload);
      const criteria = resolveCriteria(field, spec?.criteria, spec?.must_capture);
      // Reference is the source chunk text — the same material production analyzed.
      const judge =
        value === undefined || value === null
          ? ({ ok: false, raw: '', summary: `field '${field}' missing/null — nothing to judge`, prompt: '' } as JudgeResult)
          : await runJudge({ transport: judgeTransport, input: c.input ?? '', field, output: value, criteria });
      judges.push({ field, output: value, criteria, judge });
    }
    return {
      op: 'node',
      model: graphModel,
      judgeModel,
      mocked: node.mocked,
      latencyMs: node.latencyMs,
      messages: node.messages,
      raw: node.raw,
      parse: node.parse,
      node,
      judges,
    };
  }

  // op === 'edge'
  const source = await resolveSide(c.source!, graphTransport, settings);
  const target = await resolveSide(c.target!, graphTransport, settings);
  const edge = await runEdgeOp(source.ref, target.ref, graphTransport, settings);
  const primaryEdge = [...edge.edges]
    .filter((e) => e.valid)
    .sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
  const derivedClaims =
    source.derived || target.derived ? { source: source.derived, target: target.derived } : undefined;

  for (const [field, spec] of Object.entries(judgeSpecs)) {
    // The only NL field on an edge is `reasoning`; judge it against the claims + chosen relation.
    const value = field === 'reasoning' ? primaryEdge?.reasoning : undefined;
    const criteria = resolveCriteria(field, spec?.criteria, spec?.must_capture);
    const reference = `Source claims: ${JSON.stringify(source.ref.key_claims)}\nTarget claims: ${JSON.stringify(target.ref.key_claims)}\nChosen relation: ${primaryEdge?.relation ?? '(none)'}`;
    const judge =
      value === undefined || value === null
        ? ({ ok: false, raw: '', summary: primaryEdge ? `field '${field}' not judgeable` : 'no valid edge to judge', prompt: '' } as JudgeResult)
        : await runJudge({ transport: judgeTransport, input: reference, field: `edge ${field}`, output: value, criteria });
    judges.push({ field, output: value, criteria, judge });
  }

  return {
    op: 'edge',
    model: graphModel,
    judgeModel,
    mocked: edge.mocked,
    latencyMs: edge.latencyMs,
    messages: edge.messages,
    raw: edge.raw,
    parse: edge.parse,
    edge,
    primaryEdge,
    derivedClaims,
    judges,
  };
}
