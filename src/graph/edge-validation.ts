import type { GraphRelationDefinition } from './vocabulary.js';

export type GraphEdgeConfidence = 'EXTRACTED' | 'INFERRED';
const LLM_ASSESSMENT_RUBRIC = new Set(['strong', 'moderate', 'weak', 'uncertain']);

export interface GraphEdgeMetadata {
  qualifiers?: {
    temporal?: string[] | null;
    conditional?: string[] | null;
    uncertainty?: string[] | null;
  };
  llm_assessment?: 'strong' | 'moderate' | 'weak' | 'uncertain';
  low_confidence_flag?: boolean;
  lint_flags?: string[];
  [key: string]: unknown;
}

export interface GraphEdgeDraft {
  relation: string;
  confidence: GraphEdgeConfidence;
  confidenceScore: number;
  reasoning?: string | null;
  metadata?: GraphEdgeMetadata | null;
}

export function validateGraphEdgeDraft(
  edge: GraphEdgeDraft,
  relations: GraphRelationDefinition[]
): void {
  const relation = relations.find((candidate) => candidate.name === edge.relation);
  const errors: string[] = [];

  if (!relation) {
    errors.push(`Unknown graph relation '${edge.relation}'`);
  }

  if (relation?.category === 'structural') {
    if (edge.confidence !== 'EXTRACTED') {
      errors.push(`Structural graph relation '${edge.relation}' must use confidence EXTRACTED`);
    }
    if (edge.confidenceScore !== 1.0) {
      errors.push(`Structural graph relation '${edge.relation}' must use confidence_score 1.0`);
    }
  }

  if (relation?.category === 'classified') {
    if (edge.confidence !== 'INFERRED') {
      errors.push(`Classified graph relation '${edge.relation}' must use confidence INFERRED`);
    }
    if (!edge.reasoning?.trim()) {
      errors.push(`Classified graph relation '${edge.relation}' requires non-empty reasoning`);
    }
  }

  const qualifiers = edge.metadata?.qualifiers;
  if (qualifiers) {
    for (const key of ['temporal', 'conditional', 'uncertainty'] as const) {
      const value = qualifiers[key];
      if (value !== undefined && value !== null && !isStringArray(value)) {
        errors.push(`metadata.qualifiers.${key} must be string[] or null`);
      }
    }
  }

  const llmAssessment = edge.metadata?.llm_assessment;
  if (llmAssessment !== undefined && !LLM_ASSESSMENT_RUBRIC.has(String(llmAssessment))) {
    errors.push(
      "metadata.llm_assessment must be one of 'strong', 'moderate', 'weak', or 'uncertain'"
    );
  }

  const lowConfidenceFlag = edge.metadata?.low_confidence_flag;
  if (lowConfidenceFlag !== undefined && typeof lowConfidenceFlag !== 'boolean') {
    errors.push('metadata.low_confidence_flag must be boolean when present');
  }

  const metadataSchema = relation?.metadataSchema;
  if (metadataSchema && edge.metadata) {
    for (const key of Object.keys(edge.metadata)) {
      if (
        key !== 'qualifiers' &&
        key !== 'llm_assessment' &&
        key !== 'low_confidence_flag' &&
        key !== 'lint_flags' &&
        !(key in metadataSchema)
      ) {
        errors.push(`metadata.${key} is not allowed for relation '${edge.relation}'`);
      }
    }
  }

  if (edge.metadata?.low_confidence_flag === true) {
    edge.metadata.lint_flags = [...new Set([...(edge.metadata.lint_flags ?? []), 'low_confidence'])];
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
