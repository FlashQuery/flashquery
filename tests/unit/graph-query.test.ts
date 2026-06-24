import { describe, expect, it } from 'vitest';
import {
  createInMemoryGraphQueryStore,
  queryGraph,
  type GraphQueryStoreSeed,
} from '../../src/graph/queries.js';
import { DEFAULT_GRAPH_RELATIONS } from '../../src/graph/vocabulary.js';

function parseResult(result: { content: Array<{ type: 'text'; text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? '{}');
}

function seedGraph(): GraphQueryStoreSeed {
  return {
    nodes: [
      {
        chunk_id: 'a',
        instance_id: 'instance-a',
        document_id: 'doc-a',
        document_path: 'A.md',
        document_title: 'A',
        document_status: 'active',
        heading_path: 'A',
        breadcrumb: 'A',
        provenance_basis: 'source:a',
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
      },
      {
        chunk_id: 'b',
        instance_id: 'instance-a',
        document_id: 'doc-b',
        document_path: 'B.md',
        document_title: 'B',
        document_status: 'active',
        heading_path: 'B',
        breadcrumb: 'B',
        provenance_basis: null,
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
      },
      {
        chunk_id: 'c',
        instance_id: 'instance-a',
        document_id: 'doc-c',
        document_path: 'C.md',
        document_title: 'C',
        document_status: 'active',
        heading_path: 'C',
        breadcrumb: 'C',
        provenance_basis: 'source:c',
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
      },
      {
        chunk_id: 'other',
        instance_id: 'instance-b',
        document_id: 'doc-other',
        document_path: 'Other.md',
        document_title: 'Other',
        document_status: 'active',
        heading_path: 'Other',
        breadcrumb: 'Other',
        provenance_basis: null,
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
      },
    ],
    edges: [
      {
        id: 'edge-a-b',
        instance_id: 'instance-a',
        source_chunk_id: 'a',
        target_chunk_id: 'b',
        relation: 'references',
        confidence: 'EXTRACTED',
        confidence_score: 1,
        reasoning: null,
        model: null,
        status: 'active',
        metadata: {},
      },
      {
        id: 'edge-b-c',
        instance_id: 'instance-a',
        source_chunk_id: 'b',
        target_chunk_id: 'c',
        relation: 'supports',
        confidence: 'INFERRED',
        confidence_score: 0.61,
        reasoning: 'B supports C',
        model: 'mock',
        status: 'active',
        metadata: {},
      },
      {
        id: 'edge-c-a',
        instance_id: 'instance-a',
        source_chunk_id: 'c',
        target_chunk_id: 'a',
        relation: 'references',
        confidence: 'EXTRACTED',
        confidence_score: 1,
        reasoning: null,
        model: null,
        status: 'active',
        metadata: {},
      },
      {
        id: 'edge-other',
        instance_id: 'instance-b',
        source_chunk_id: 'other',
        target_chunk_id: 'a',
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
}

describe('graph query helpers', () => {
  it('T-U-028 rejects invalid action and parameter combinations as expected errors', async () => {
    const store = createInMemoryGraphQueryStore(seedGraph());

    const unknown = await queryGraph(store, { instance_id: 'instance-a', action: 'missing' });
    expect(unknown.isError).toBe(false);
    expect(parseResult(unknown)).toMatchObject({
      error: 'invalid_input',
      details: { code: 'graph_invalid_action' },
    });

    const missingChunk = await queryGraph(store, { instance_id: 'instance-a', action: 'neighbors' });
    expect(missingChunk.isError).toBe(false);
    expect(parseResult(missingChunk)).toMatchObject({
      error: 'invalid_input',
      details: { code: 'graph_missing_parameter', parameter: 'chunk_id' },
    });
  });

  it('T-U-029 enforces max depth, relation filters, instance isolation, and JSON-friendly traversal payloads', async () => {
    const store = createInMemoryGraphQueryStore(seedGraph());

    const result = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'neighbors',
      chunk_id: 'a',
      max_depth: 2,
      relations: ['references'],
    });

    const payload = parseResult(result) as {
      data: { nodes: Array<{ chunk_id: string }>; edges: Array<{ id: string; relation: string }> };
    };

    expect(payload.data.nodes.map((node) => node.chunk_id)).toEqual(['a', 'b', 'c']);
    expect(payload.data.edges.map((edge) => [edge.id, edge.relation])).toEqual([
      ['edge-a-b', 'references'],
      ['edge-c-a', 'references'],
    ]);
    expect(JSON.stringify(payload)).not.toContain('source_chunk_id');
    expect(JSON.stringify(payload)).not.toContain('instance-b');
  });

  it('T-U-060 terminates traversal over cyclic graphs via visited-set cycle protection', async () => {
    const store = createInMemoryGraphQueryStore(seedGraph());

    const result = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'subgraph',
      chunk_id: 'a',
      max_depth: 10,
      limit: 10,
    });

    const payload = parseResult(result) as {
      data: { nodes: Array<{ chunk_id: string }>; edges: Array<{ id: string }> };
    };

    expect(payload.data.nodes.map((node) => node.chunk_id).sort()).toEqual(['a', 'b', 'c']);
    expect(payload.data.edges.map((edge) => edge.id).sort()).toEqual([
      'edge-a-b',
      'edge-b-c',
      'edge-c-a',
    ]);
  });

  it('T-U-069 shapes schema from loaded vocabulary and graph feature flags', async () => {
    const store = createInMemoryGraphQueryStore(seedGraph());

    const result = await queryGraph(
      store,
      { instance_id: 'instance-a', action: 'schema' },
      {
        relations: DEFAULT_GRAPH_RELATIONS,
        graph: {
          enabled: true,
          similarity_mode: 'percentile',
          similarity_threshold: 0.72,
          similarity_percentile: 91,
          classification_enabled: true,
          communities: 'seeded_read_only',
        },
      }
    );

    const payload = parseResult(result) as {
      data: {
        relations: Array<{ name: string; directionality: string; detection_method: string }>;
        features: Record<string, unknown>;
      };
    };

    expect(payload.data.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'contains',
          directionality: 'directed',
          detection_method: 'structural',
        }),
        expect.objectContaining({
          name: 'contradicts',
          directionality: 'symmetric',
          detection_method: 'classified',
        }),
      ])
    );
    expect(payload.data.features).toMatchObject({
      enabled: true,
      similarity_mode: 'percentile',
      similarity_threshold: 0.72,
      similarity_percentile: 91,
      classification_enabled: true,
      communities: 'seeded_read_only',
    });
  });
});
