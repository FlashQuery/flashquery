import { z } from 'zod';

export const GraphQuestionStatusSchema = z.enum(['open', 'deferred', 'resolved']).nullable();
export const GraphCertaintyLevelSchema = z.enum(['high', 'medium', 'low', 'unknown']);
export const GraphStalenessRiskSchema = z.enum(['low', 'medium', 'high', 'unknown']);
export const GraphLlmAssessmentSchema = z.enum(['strong', 'moderate', 'weak', 'uncertain']);
export const GraphNodeAnalysisStringSchema = z.string().min(1);

export const GraphNodeAnalysisPayloadSchema = z
  .object({
    // Optional chain-of-thought written first to improve the downstream fields; NOT persisted
    // (buildGraphNodeAnalysisRow ignores it).
    reasoning: z.string().optional(),
    key_claims: z.array(GraphNodeAnalysisStringSchema).default([]),
    chunk_summary: z.string().min(1),
    provenance_basis: z.string().min(1).nullable(),
    question_status: GraphQuestionStatusSchema,
    question_resolution: z.string().min(1).nullable(),
    certainty_level: GraphCertaintyLevelSchema,
    staleness_risk: GraphStalenessRiskSchema,
    external_refs: z.array(GraphNodeAnalysisStringSchema).default([]),
    temporal_markers: z.array(GraphNodeAnalysisStringSchema).default([]),
    analyzed_content_hash: z.string().default(''),
  })
  .strict();

export const GraphEdgeMetadataSchema = z
  .object({
    qualifiers: z
      .object({
        temporal: z.array(z.string().min(1)).nullable().optional(),
        conditional: z.array(z.string().min(1)).nullable().optional(),
        uncertainty: z.array(z.string().min(1)).nullable().optional(),
      })
      .strict()
      .optional(),
    llm_assessment: GraphLlmAssessmentSchema,
    low_confidence_flag: z.boolean().optional(),
    lint_flags: z.array(z.string().min(1)).optional(),
  })
  .catchall(z.unknown());

export const GraphEdgeClassificationDraftSchema = z
  .object({
    relation: z.string().min(1),
    reasoning: z.string().min(1),
    source_claims_referenced: z.array(z.number().int().min(0)),
    target_claims_referenced: z.array(z.number().int().min(0)),
    confidence_score: z.number().min(0).max(1).default(0.5),
    metadata: GraphEdgeMetadataSchema,
  })
  .strict();

export const GraphEdgeClassificationPayloadSchema = z
  .object({
    edges: z.array(GraphEdgeClassificationDraftSchema).default([]),
  })
  .strict();

export type GraphNodeAnalysisPayload = z.infer<typeof GraphNodeAnalysisPayloadSchema>;
export type GraphKeyClaim = z.infer<typeof GraphNodeAnalysisStringSchema>;
export type GraphExternalRef = z.infer<typeof GraphNodeAnalysisStringSchema>;
export type GraphTemporalMarker = z.infer<typeof GraphNodeAnalysisStringSchema>;
export type GraphEdgeClassificationPayload = z.infer<typeof GraphEdgeClassificationPayloadSchema>;
export type GraphEdgeClassificationDraft = z.infer<typeof GraphEdgeClassificationDraftSchema>;
