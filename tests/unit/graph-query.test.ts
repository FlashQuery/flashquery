import { describe, expect, it } from 'vitest';
import {
  createInMemoryGraphQueryStore,
  createPgGraphQueryStore,
  queryGraph,
  toNodePayload,
  type GraphNodePayload,
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
        content: '## A\n\nA establishes the baseline.',
        provenance_basis: 'source:a',
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
        key_claims: ['A establishes the baseline'],
        chunk_summary: 'A summarizes the baseline.',
        certainty_level: 'high',
        staleness_risk: 'low',
        external_refs: ['RFC 8259'],
        temporal_markers: ['Q3 2026'],
        analyzed_content_hash: 'hash-a',
        content_hash: 'hash-a',
        analyzed_by_model: 'mock-node@v1',
        analyzed_at: '2026-06-23T00:00:00.000Z',
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
        content: '## B\n\nB references A and supports C.',
        provenance_basis: null,
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
        key_claims: null,
        chunk_summary: null,
        certainty_level: null,
        staleness_risk: null,
        external_refs: null,
        temporal_markers: null,
        analyzed_content_hash: null,
        content_hash: 'hash-b',
        analyzed_by_model: null,
        analyzed_at: null,
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
        content: '## C\n\nC may change over time.',
        provenance_basis: 'source:c',
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
        key_claims: ['C may change'],
        chunk_summary: 'C summarizes changing information.',
        certainty_level: 'medium',
        staleness_risk: 'high',
        external_refs: [],
        temporal_markers: ['v2.1.0'],
        analyzed_content_hash: 'old-hash-c',
        content_hash: 'hash-c',
        analyzed_by_model: 'mock-node@v1',
        analyzed_at: '2026-06-23T00:01:00.000Z',
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
        content: '## Other\n\nOther instance content.',
        provenance_basis: null,
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
        key_claims: null,
        chunk_summary: null,
        certainty_level: null,
        staleness_risk: null,
        external_refs: null,
        temporal_markers: null,
        analyzed_content_hash: null,
        content_hash: 'hash-other',
        analyzed_by_model: null,
        analyzed_at: null,
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

  it('T-U-029 exposes node analysis metadata and computed staleness on node drill-down', async () => {
    const store = createInMemoryGraphQueryStore(seedGraph());

    const fresh = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'node',
      chunk_id: 'a',
    });
    const freshPayload = parseResult(fresh) as {
      data: {
        node: Pick<
          GraphNodePayload,
          | 'key_claims'
          | 'chunk_summary'
          | 'certainty_level'
          | 'staleness_risk'
          | 'external_refs'
          | 'temporal_markers'
          | 'analyzed_at'
          | 'analyzed_by_model'
          | 'stale'
        >;
      };
    };
    expect(freshPayload.data.node).toMatchObject({
      key_claims: ['A establishes the baseline'],
      chunk_summary: 'A summarizes the baseline.',
      certainty_level: 'high',
      staleness_risk: 'low',
      external_refs: ['RFC 8259'],
      temporal_markers: ['Q3 2026'],
      analyzed_at: '2026-06-23T00:00:00.000Z',
      analyzed_by_model: 'mock-node@v1',
      stale: false,
    });

    const missing = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'node',
      chunk_id: 'b',
    });
    const missingPayload = parseResult(missing) as { data: { node: Record<string, unknown> } };
    expect(missingPayload.data.node).toMatchObject({
      key_claims: null,
      chunk_summary: null,
      certainty_level: null,
      staleness_risk: null,
      external_refs: null,
      temporal_markers: null,
      analyzed_at: null,
      analyzed_by_model: null,
      stale: true,
    });

    const stale = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'node',
      chunk_id: 'c',
    });
    const stalePayload = parseResult(stale) as { data: { node: { stale: boolean } } };
    expect(stalePayload.data.node.stale).toBe(true);
  });

  it('T-U-005 maps node content only when includeContent is true', () => {
    const row = seedGraph().nodes[0];

    expect(toNodePayload(row, { includeContent: true }).content).toBe('## A\n\nA establishes the baseline.');
    expect(toNodePayload(row, { includeContent: false }).content).toBeNull();
    expect(toNodePayload(row).content).toBeNull();
  });

  it('T-U-006 applies query_graph content defaults and overrides to top-level and nested nodes', async () => {
    const store = createInMemoryGraphQueryStore(seedGraph());

    const nodeDefault = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'node',
      chunk_id: 'a',
    });
    const nodeDefaultPayload = parseResult(nodeDefault) as { data: { node: GraphNodePayload } };
    expect(nodeDefaultPayload.data.node.content).toBe('## A\n\nA establishes the baseline.');

    const nodeSuppressed = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'node',
      chunk_id: 'a',
      include_content: false,
    });
    const nodeSuppressedPayload = parseResult(nodeSuppressed) as { data: { node: GraphNodePayload } };
    expect(nodeSuppressedPayload.data.node.content).toBeNull();

    const neighborsDefault = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'neighbors',
      chunk_id: 'a',
      max_depth: 1,
    });
    const neighborsDefaultPayload = parseResult(neighborsDefault) as {
      data: { nodes: GraphNodePayload[]; edges: Array<{ source: GraphNodePayload; target: GraphNodePayload }> };
    };
    expect(neighborsDefaultPayload.data.nodes.map((node) => node.content)).toEqual([null, null, null]);
    expect(neighborsDefaultPayload.data.edges.flatMap((edge) => [edge.source.content, edge.target.content])).toEqual([
      null,
      null,
      null,
      null,
    ]);

    const neighborsWithContent = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'neighbors',
      chunk_id: 'a',
      max_depth: 1,
      include_content: true,
    });
    const neighborsWithContentPayload = parseResult(neighborsWithContent) as {
      data: { nodes: GraphNodePayload[]; edges: Array<{ source: GraphNodePayload; target: GraphNodePayload }> };
    };
    expect(neighborsWithContentPayload.data.nodes.map((node) => [node.chunk_id, node.content]).sort()).toEqual([
      ['a', '## A\n\nA establishes the baseline.'],
      ['b', '## B\n\nB references A and supports C.'],
      ['c', '## C\n\nC may change over time.'],
    ]);
    expect(neighborsWithContentPayload.data.edges.flatMap((edge) => [edge.source.content, edge.target.content])).toEqual([
      '## A\n\nA establishes the baseline.',
      '## B\n\nB references A and supports C.',
      '## C\n\nC may change over time.',
      '## A\n\nA establishes the baseline.',
    ]);
  });

  it('T-U-008 selects chunk content in the PostgreSQL graph query store', async () => {
    const queries: string[] = [];
    const store = createPgGraphQueryStore({
      async query(sql) {
        queries.push(sql);
        return { rows: [] };
      },
    });

    await store.listNodes('instance-a');

    expect(queries[0]).toContain('c.content,');
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

  it('returns multi-hop weak paths with computed weakest link', async () => {
    const store = createInMemoryGraphQueryStore(seedGraph());

    const result = await queryGraph(store, {
      instance_id: 'instance-a',
      action: 'weak_paths',
      chunk_id: 'a',
      max_depth: 3,
      confidence_threshold: 0.7,
    });

    const payload = parseResult(result) as {
      data: {
        paths: Array<{ nodes: Array<{ chunk_id: string }>; edges: Array<{ id: string }>; weakest_confidence_score: number }>;
        edges: Array<{ id: string }>;
      };
    };

    expect(payload.data.paths).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodes: [
          expect.objectContaining({ chunk_id: 'a' }),
          expect.objectContaining({ chunk_id: 'b' }),
          expect.objectContaining({ chunk_id: 'c' }),
        ],
        edges: [
          expect.objectContaining({ id: 'edge-a-b' }),
          expect.objectContaining({ id: 'edge-b-c' }),
        ],
        weakest_confidence_score: 0.61,
      }),
    ]));
    expect(payload.data.edges).toEqual([expect.objectContaining({ id: 'edge-b-c' })]);
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
      classification_resolver: 'configured',
      communities: 'seeded_read_only',
    });
  });

  it('T-U-069 derives schema community state from graph rows when not overridden', async () => {
    const graph = seedGraph();
    graph.nodes[0] = {
      ...graph.nodes[0],
      community_id: 'community-a',
      community_label: 'Community A',
      community_summary: 'A detected community.',
    };
    const result = await queryGraph(
      createInMemoryGraphQueryStore(graph),
      { instance_id: 'instance-a', action: 'schema' },
      {
        relations: DEFAULT_GRAPH_RELATIONS,
        graph: { enabled: true, classification_enabled: false },
      }
    );

    const payload = parseResult(result) as { data: { features: Record<string, unknown> } };
    expect(payload.data.features).toMatchObject({
      classification_resolver: 'disabled',
      communities: 'detected:1',
    });
  });

  it('T-U-062 bounds runtime error payloads without raw causes or secrets', async () => {
    const result = await queryGraph(
      {
        listNodes: async () => {
          throw new Error('postgres://user:password@example.test/db failed with sk-live-123');
        },
        listEdges: async () => [],
      },
      { instance_id: 'instance-a', action: 'stats' }
    );

    const serialized = JSON.stringify(parseResult(result));
    expect(serialized).toContain('graph_runtime_error');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('sk-live-123');
  });
});
