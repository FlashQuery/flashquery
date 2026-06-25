// Edge-classification operation: build the (editable) prompt, call the model,
// then run the result through the REAL parser/schema AND the REAL per-edge
// validator imported from src/graph. Mirrors classifyGraphEdgeCandidate()'s
// parse + validate path minus the Supabase write and claim-index bounds check
// (the bounds check lives in an unexported helper; we re-derive it cheaply here).

import { validateGraphEdgeDraft } from '../../../src/graph/edge-validation.js';
import { parseGraphEdgeClassificationPayload } from '../../../src/graph/llm-analysis.js';
import { DEFAULT_GRAPH_RELATIONS } from '../../../src/graph/vocabulary.js';
import type { Settings } from './config.ts';
import type { ChatMessage, LlmTransport } from './llm-client.ts';
import { buildEdgeMessages, type ChunkRef } from './prompts.ts';
import type { ParseInfo } from './node-op.ts';

export interface ValidatedEdge {
  relation: string;
  confidenceScore: number;
  reasoning: string;
  sourceClaimsReferenced: number[];
  targetClaimsReferenced: number[];
  llmAssessment?: string;
  /** Which qualifier kinds the model attached non-empty arrays for. */
  qualifierKinds: string[];
  /** Passed the real validateGraphEdgeDraft + relation/index sanity checks. */
  valid: boolean;
  validationError?: string;
}

export interface EdgeOpResult {
  messages: ChatMessage[];
  raw: string;
  model: string;
  mocked: boolean;
  latencyMs: number;
  parse: ParseInfo;
  edges: ValidatedEdge[];
}

export async function runEdgeOp(
  source: ChunkRef,
  target: ChunkRef,
  transport: LlmTransport,
  settings: Settings
): Promise<EdgeOpResult> {
  const messages = buildEdgeMessages(source, target, settings);
  const completion = await transport.complete(messages);
  const parsed = parseGraphEdgeClassificationPayload(completion.text);

  const base = {
    messages,
    raw: completion.text,
    model: completion.model,
    mocked: completion.mocked,
    latencyMs: completion.latencyMs,
  };

  if (!parsed.ok) {
    return {
      ...base,
      parse: { ok: false, failure: parsed.failure, repaired: parsed.repaired, summary: parsed.summary },
      edges: [],
    };
  }

  const edges: ValidatedEdge[] = parsed.data.edges.map((edge) => {
    let valid = true;
    let validationError: string | undefined;
    try {
      validateGraphEdgeDraft(
        {
          relation: edge.relation,
          confidence: 'INFERRED',
          confidenceScore: edge.confidence_score,
          reasoning: edge.reasoning,
          metadata: edge.metadata,
        },
        DEFAULT_GRAPH_RELATIONS
      );
      // Claim-index bounds (re-derived from edge-analysis.ts buildClassifiedEdge).
      for (const i of edge.source_claims_referenced) {
        if (i >= source.key_claims.length) throw new Error(`source claim index ${i} out of bounds`);
      }
      for (const i of edge.target_claims_referenced) {
        if (i >= target.key_claims.length) throw new Error(`target claim index ${i} out of bounds`);
      }
    } catch (err) {
      valid = false;
      validationError = err instanceof Error ? err.message : String(err);
    }
    const q = edge.metadata?.qualifiers ?? {};
    const qualifierKinds = (['temporal', 'conditional', 'uncertainty'] as const).filter(
      (k) => Array.isArray(q[k]) && (q[k]?.length ?? 0) > 0
    );
    return {
      relation: edge.relation,
      confidenceScore: edge.confidence_score,
      reasoning: edge.reasoning,
      sourceClaimsReferenced: edge.source_claims_referenced,
      targetClaimsReferenced: edge.target_claims_referenced,
      llmAssessment: edge.metadata?.llm_assessment,
      qualifierKinds,
      valid,
      validationError,
    };
  });

  return { ...base, parse: { ok: true, repaired: parsed.repaired }, edges };
}
