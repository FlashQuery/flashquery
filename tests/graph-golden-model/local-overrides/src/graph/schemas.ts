// LOCAL OVERRIDE of src/graph/schemas.ts (node payload only).
//
// Path mirrors production: local-overrides/src/graph/schemas.ts ⇄ src/graph/schemas.ts.
// Per the production-first / local-override policy (README §3.7, PORT_BACK §5.1): the workbench uses
// the REAL production source by default; a file appears here ONLY because testing required a change
// that is staged for the one-shot push (PORT_BACK §1.4). Remove this file after the change lands in
// production. Exports use the SAME names as production so it is a drop-in.
//
// Proposed deltas vs. production `GraphNodeAnalysisPayloadSchema`:
//   - optional `reasoning` field (chain-of-thought inside the JSON; not persisted)
//   - `analyzed_content_hash` relaxed from .min(1) to .default('') (model can't compute it;
//     node-analysis.ts supplies it post-parse via fallbackContentHash)
//
// The edge schemas are unchanged from production, so the workbench keeps using the real ones.

import { z } from 'zod';

const QuestionStatus = z.enum(['open', 'deferred', 'resolved']).nullable();
const Certainty = z.enum(['high', 'medium', 'low', 'unknown']);
const Staleness = z.enum(['low', 'medium', 'high', 'unknown']);

export const GraphNodeAnalysisPayloadSchema = z
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

export type GraphNodeAnalysisPayload = z.infer<typeof GraphNodeAnalysisPayloadSchema>;
