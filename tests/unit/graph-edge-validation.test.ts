import { describe, expect, it } from 'vitest';
import { validateGraphEdgeDraft } from '../../src/graph/edge-validation.js';
import { DEFAULT_GRAPH_RELATIONS } from '../../src/graph/vocabulary.js';

describe('graph edge validation', () => {
  it('T-U-017 Tier 3 edge without reasoning is rejected', () => {
    expect(() =>
      validateGraphEdgeDraft(
        { relation: 'supports', confidence: 'INFERRED', confidenceScore: 0.7 },
        DEFAULT_GRAPH_RELATIONS
      )
    ).toThrow(/requires non-empty reasoning/i);
  });

  it('T-U-018 relation-specific metadata validates against vocabulary schema', () => {
    expect(() =>
      validateGraphEdgeDraft(
        {
          relation: 'references',
          confidence: 'EXTRACTED',
          confidenceScore: 1.0,
          metadata: { unresolved_anchor: 'Details' },
        },
        DEFAULT_GRAPH_RELATIONS
      )
    ).not.toThrow();
  });

  it('T-U-054 Tier 1 edge carries EXTRACTED confidence and score 1.0', () => {
    expect(() =>
      validateGraphEdgeDraft(
        { relation: 'contains', confidence: 'INFERRED', confidenceScore: 0.9 },
        DEFAULT_GRAPH_RELATIONS
      )
    ).toThrow(/confidence EXTRACTED|confidence_score 1.0/i);
  });

  it('T-U-055 qualifiers accept string arrays and null but reject other shapes', () => {
    expect(() =>
      validateGraphEdgeDraft(
        {
          relation: 'supports',
          confidence: 'INFERRED',
          confidenceScore: 0.8,
          reasoning: 'Both chunks cite the same claim.',
          metadata: { qualifiers: { temporal: ['now'], conditional: null, uncertainty: 'low' as never } },
        },
        DEFAULT_GRAPH_RELATIONS
      )
    ).toThrow(/qualifiers\.uncertainty/i);
  });

  it('T-U-077 low-confidence Tier 3 edges remain stored and are flagged for lint', () => {
    const edge = {
      relation: 'supports',
      confidence: 'INFERRED' as const,
      confidenceScore: 0.4,
      reasoning: 'The support is indirect but present.',
      metadata: { llm_assessment: 'weak' as const, low_confidence_flag: true },
    };

    validateGraphEdgeDraft(edge, DEFAULT_GRAPH_RELATIONS);

    expect(edge.metadata.lint_flags).toContain('low_confidence');
  });

  it('T-U-077 rejects freeform llm_assessment values outside the discrete rubric', () => {
    expect(() =>
      validateGraphEdgeDraft(
        {
          relation: 'supports',
          confidence: 'INFERRED',
          confidenceScore: 0.7,
          reasoning: 'The source directly supports the target.',
          metadata: { llm_assessment: 'pretty good' as never },
        },
        DEFAULT_GRAPH_RELATIONS
      )
    ).toThrow(/llm_assessment/i);
  });
});
