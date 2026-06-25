// LOCAL copies of graph payload schemas, carrying changes we PROPOSE for production
// but have NOT pushed yet — production source stays untouched until one deliberate
// push. The workbench parses against these (via the real parseLlmJson corrector),
// so we can validate the proposed schema before it ever lands in src/graph.
//
// Proposed deltas vs. src/graph/schemas.ts (see ../PORT_BACK.md):
//   - node: optional `reasoning` field (chain-of-thought inside the JSON)
//   - node: analyzed_content_hash relaxed from .min(1) to .default('') — the model
//           cannot compute a hash; node-analysis.ts fills it via fallbackContentHash.
//
// The edge schema is unchanged from production, so the workbench keeps using the real
// one directly. Mirror any future edge-schema change here too.

import { z } from 'zod';

const QuestionStatus = z.enum(['open', 'deferred', 'resolved']).nullable();
const Certainty = z.enum(['high', 'medium', 'low', 'unknown']);
const Staleness = z.enum(['low', 'medium', 'high', 'unknown']);

export const LocalGraphNodeAnalysisPayloadSchema = z
  .object({
    reasoning: z.string().optional(), // PROPOSED
    key_claims: z.array(z.string().min(1)).default([]),
    chunk_summary: z.string().min(1),
    provenance_basis: z.string().min(1).nullable(),
    question_status: QuestionStatus,
    question_resolution: z.string().min(1).nullable(),
    certainty_level: Certainty,
    staleness_risk: Staleness,
    external_refs: z.array(z.string().min(1)).default([]),
    temporal_markers: z.array(z.string().min(1)).default([]),
    analyzed_content_hash: z.string().default(''), // PROPOSED (was .min(1))
  })
  .strict();

export type LocalGraphNodeAnalysisPayload = z.infer<typeof LocalGraphNodeAnalysisPayloadSchema>;
