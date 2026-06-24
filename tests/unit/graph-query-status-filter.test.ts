import { describe, expect, it } from 'vitest';
import {
  filterGraphEdgesForSurface,
  filterGraphNodesForSurface,
  type GraphEdgePayload,
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
});
