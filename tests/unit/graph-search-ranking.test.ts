import { describe, expect, it } from 'vitest';
import {
  adjacentGraphEdges,
  rankGraphSearchCandidates,
  type GraphSearchEdge,
  type GraphSearchExpansionCandidate,
  type GraphSearchOptions,
} from '../../src/mcp/tools/compound.js';

function candidate(input: Partial<GraphSearchExpansionCandidate> & Pick<GraphSearchExpansionCandidate, 'chunk_id' | 'path'>): GraphSearchExpansionCandidate {
  return {
    chunk_id: input.chunk_id,
    document_id: input.document_id ?? `doc-${input.chunk_id}`,
    path: input.path,
    title: input.title ?? input.path,
    tags: input.tags ?? [],
    document_status: input.document_status ?? 'active',
    heading_path: input.heading_path ?? input.path,
    breadcrumb: input.breadcrumb ?? input.heading_path ?? input.path,
    content: input.content ?? `content ${input.chunk_id}`,
    relation: input.relation ?? 'references',
    stale: input.stale ?? false,
    confidence_score: input.confidence_score ?? 0.5,
    seed_score: input.seed_score ?? 0.5,
    seed_chunk_id: input.seed_chunk_id ?? 'seed',
    edge_id: input.edge_id ?? `edge-${input.chunk_id}`,
    depth: input.depth ?? 1,
    community_id: input.community_id ?? null,
    community_label: input.community_label ?? null,
    community_summary: input.community_summary ?? null,
  };
}

describe('graph-expanded search ranking', () => {
  it('T-U-061 orders by relation significance, non-stale status, confidence, then seed relevance', () => {
    const ranked = rankGraphSearchCandidates([
      candidate({ chunk_id: 'reference', path: 'reference.md', relation: 'references', confidence_score: 1, seed_score: 1 }),
      candidate({ chunk_id: 'stale-support', path: 'stale.md', relation: 'supports', stale: true, confidence_score: 1, seed_score: 1 }),
      candidate({ chunk_id: 'weak-support', path: 'weak.md', relation: 'supports', confidence_score: 0.5, seed_score: 1 }),
      candidate({ chunk_id: 'seed-low', path: 'seed-low.md', relation: 'supports', confidence_score: 0.9, seed_score: 0.2 }),
      candidate({ chunk_id: 'seed-high', path: 'seed-high.md', relation: 'supports', confidence_score: 0.9, seed_score: 0.8 }),
      candidate({ chunk_id: 'top', path: 'top.md', relation: 'contradicts', confidence_score: 0.6, seed_score: 0.1 }),
    ]);

    expect(ranked.map((item) => item.chunk_id)).toEqual([
      'top',
      'seed-high',
      'seed-low',
      'weak-support',
      'stale-support',
      'reference',
    ]);
  });

  it('does not traverse directed graph relations backward from a target seed', () => {
    const options: GraphSearchOptions = {
      enabled: true,
      maxDepth: 1,
      includeStale: false,
      includeInactive: false,
      includeCommunity: false,
    };
    const edges: GraphSearchEdge[] = [
      {
        id: 'contains-edge',
        source_chunk_id: 'parent',
        target_chunk_id: 'child',
        relation: 'contains',
        confidence_score: 1,
        stale: false,
      },
      {
        id: 'contradicts-edge',
        source_chunk_id: 'left',
        target_chunk_id: 'right',
        relation: 'contradicts',
        confidence_score: 1,
        stale: false,
      },
    ];

    expect(adjacentGraphEdges(edges, 'child', options).map((edge) => edge.id)).toEqual([]);
    expect(adjacentGraphEdges(edges, 'left', options).map((edge) => edge.id)).toEqual(['contradicts-edge']);
    expect(adjacentGraphEdges(edges, 'right', options).map((edge) => edge.id)).toEqual(['contradicts-edge']);
  });
});
