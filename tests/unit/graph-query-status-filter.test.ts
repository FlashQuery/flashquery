import { describe, expect, it } from 'vitest';
import {
  createInMemoryGraphQueryStore,
  filterGraphEdgesForSurface,
  filterGraphNodesForSurface,
  queryGraph,
  type GraphEdgePayload,
  type GraphEdgeRow,
  type GraphNodeRow,
  type GraphNodePayload,
} from '../../src/graph/queries.js';

const activeNode: GraphNodePayload = {
  chunk_id: 'active',
  document: { id: 'doc-active', path: 'Active.md', title: 'Active', status: 'active' },
  heading_path: 'Active',
  breadcrumb: 'Active',
  provenance_basis: null,
  question_status: null,
  question_resolution: null,
  community_id: null,
  community_label: null,
  community_summary: null,
};

const archivedNode: GraphNodePayload = {
  chunk_id: 'archived',
  document: { id: 'doc-archived', path: 'Archived.md', title: 'Archived', status: 'archived' },
  heading_path: 'Archived',
  breadcrumb: 'Archived',
  provenance_basis: null,
  question_status: null,
  question_resolution: null,
  community_id: null,
  community_label: null,
  community_summary: null,
};

const activeToArchived: GraphEdgePayload = {
  id: 'edge-active-archived',
  source: activeNode,
  target: archivedNode,
  relation: 'references',
  direction: 'out',
  confidence: 'EXTRACTED',
  confidence_score: 1,
  reasoning: null,
  model: null,
  stale: false,
  metadata: {},
};

describe('graph query status filters', () => {
  it('T-U-030 applies surface-specific inactive document defaults', () => {
    expect(filterGraphNodesForSurface([activeNode, archivedNode], 'search').map((node) => node.chunk_id)).toEqual([
      'active',
    ]);
    expect(
      filterGraphNodesForSurface([activeNode, archivedNode], 'get_document').map((node) => node.chunk_id)
    ).toEqual(['active']);
    expect(
      filterGraphNodesForSurface([activeNode, archivedNode], 'query_graph').map((node) => node.chunk_id)
    ).toEqual(['active', 'archived']);
    expect(
      filterGraphNodesForSurface([activeNode, archivedNode], 'provenance_chain').map((node) => node.chunk_id)
    ).toEqual(['active', 'archived']);
  });

  it('T-U-030 hides inactive get_document targets by default but allows opt-in', () => {
    expect(filterGraphEdgesForSurface([activeToArchived], 'get_document')).toEqual([]);
    expect(filterGraphEdgesForSurface([activeToArchived], 'get_document', { include_inactive_targets: true })).toEqual([
      activeToArchived,
    ]);
  });

  it('T-U-030 lets query_graph filter by explicit document status', () => {
    expect(
      filterGraphNodesForSurface([activeNode, archivedNode], 'query_graph', {
        document_status: 'archived',
      }).map((node) => node.chunk_id)
    ).toEqual(['archived']);
  });

  it('T-U-030 applies document_status through query_graph actions but not provenance traversal', async () => {
    const nodes: GraphNodeRow[] = [
      {
        chunk_id: 'active',
        instance_id: 'test',
        document_id: 'doc-active',
        document_path: 'Active.md',
        document_title: 'Active',
        document_status: 'active',
        heading_path: 'Active',
        breadcrumb: 'Active',
        provenance_basis: null,
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
      },
      {
        chunk_id: 'archived',
        instance_id: 'test',
        document_id: 'doc-archived',
        document_path: 'Archived.md',
        document_title: 'Archived',
        document_status: 'archived',
        heading_path: 'Archived',
        breadcrumb: 'Archived',
        provenance_basis: 'source:archived',
        question_status: null,
        question_resolution: null,
        community_id: null,
        community_label: null,
        community_summary: null,
      },
    ];
    const edges: GraphEdgeRow[] = [
      {
        id: 'edge-archived-active',
        instance_id: 'test',
        source_chunk_id: 'archived',
        target_chunk_id: 'active',
        relation: 'references',
        confidence: 'EXTRACTED',
        confidence_score: 1,
        reasoning: null,
        model: null,
        status: 'active',
        metadata: {},
      },
    ];
    const store = createInMemoryGraphQueryStore({ nodes, edges });

    const stats = JSON.parse(
      (await queryGraph(store, {
        instance_id: 'test',
        action: 'stats',
        document_status: 'archived',
      })).content[0]!.text
    ) as { data: { node_count: number; edge_count: number; by_document_status: Record<string, number> } };
    expect(stats.data).toMatchObject({
      node_count: 1,
      edge_count: 1,
      by_document_status: { archived: 1 },
    });

    const activeNode = JSON.parse(
      (await queryGraph(store, {
        instance_id: 'test',
        action: 'node',
        chunk_id: 'active',
        document_status: 'archived',
      })).content[0]!.text
    ) as { data: { node: GraphNodePayload | null } };
    expect(activeNode.data.node).toBeNull();

    const provenance = JSON.parse(
      (await queryGraph(store, {
        instance_id: 'test',
        action: 'provenance_chain',
        chunk_id: 'active',
        document_status: 'active',
      })).content[0]!.text
    ) as { data: { chain: Array<{ source: { document: { status: string } } }> } };
    expect(provenance.data.chain[0]?.source.document.status).toBe('archived');
  });
});
