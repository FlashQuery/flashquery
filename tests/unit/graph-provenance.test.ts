import { describe, expect, it } from 'vitest';
import { createInMemoryGraphQueryStore, queryGraph, type GraphQueryStoreSeed } from '../../src/graph/queries.js';

function parseResult(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? '{}');
}

const nodes: GraphQueryStoreSeed['nodes'] = [
  {
    chunk_id: 'claim',
    instance_id: 'provenance-test',
    document_id: 'doc-claim',
    document_path: 'Claim.md',
    document_title: 'Claim',
    document_status: 'active',
    heading_path: 'Claim',
    breadcrumb: 'Claim',
    provenance_basis: null,
    question_status: null,
    question_resolution: null,
    community_id: null,
    community_label: null,
    community_summary: null,
  },
  {
    chunk_id: 'source-extracted',
    instance_id: 'provenance-test',
    document_id: 'doc-source',
    document_path: 'Source.md',
    document_title: 'Source',
    document_status: 'active',
    heading_path: 'Source',
    breadcrumb: 'Source',
    provenance_basis: 'source',
    question_status: null,
    question_resolution: null,
    community_id: null,
    community_label: null,
    community_summary: null,
  },
  {
    chunk_id: 'source-inferred',
    instance_id: 'provenance-test',
    document_id: 'doc-inferred',
    document_path: 'Inferred.md',
    document_title: 'Inferred',
    document_status: 'active',
    heading_path: 'Inferred',
    breadcrumb: 'Inferred',
    provenance_basis: 'inferred',
    question_status: null,
    question_resolution: null,
    community_id: null,
    community_label: null,
    community_summary: null,
  },
];

describe('graph provenance reads', () => {
  it('T-U-032 sorts extracted structural provenance before inferred edges', async () => {
    const seed: GraphQueryStoreSeed = {
      nodes,
      edges: [
        {
          id: 'inferred-first-in-storage',
          instance_id: 'provenance-test',
          source_chunk_id: 'source-inferred',
          target_chunk_id: 'claim',
          relation: 'supports',
          confidence: 'INFERRED',
          confidence_score: 0.99,
          reasoning: 'model inferred support',
          model: 'mock',
          status: 'active',
          metadata: {},
        },
        {
          id: 'extracted-second-in-storage',
          instance_id: 'provenance-test',
          source_chunk_id: 'source-extracted',
          target_chunk_id: 'claim',
          relation: 'references',
          confidence: 'EXTRACTED',
          confidence_score: 1,
          reasoning: null,
          model: null,
          status: 'active',
          metadata: {},
        },
      ],
    };

    const result = await queryGraph(createInMemoryGraphQueryStore(seed), {
      instance_id: 'provenance-test',
      action: 'provenance_chain',
      chunk_id: 'claim',
      max_depth: 1,
    });

    const payload = parseResult(result) as { data: { chain: Array<{ id: string }> } };
    expect(payload.data.chain.map((edge) => edge.id)).toEqual([
      'extracted-second-in-storage',
      'inferred-first-in-storage',
    ]);
  });
});
