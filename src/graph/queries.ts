import type { ToolResult } from '../mcp/utils/response-formats.js';
import { graphExpectedError, graphRuntimeError, graphToolResult } from './response.js';
import {
  DEFAULT_GRAPH_RELATIONS,
  type GraphRelationDefinition,
} from './vocabulary.js';

export type GraphAction =
  | 'node'
  | 'edges'
  | 'neighbors'
  | 'path'
  | 'subgraph'
  | 'stats'
  | 'schema'
  | 'contradictions'
  | 'impact'
  | 'provenance_chain'
  | 'weak_paths'
  | 'ungrounded_edges'
  | 'community_for'
  | 'community_members'
  | 'list_communities';

export type GraphDocumentStatus = 'active' | 'archived' | 'missing' | 'deleted' | (string & {});
export type GraphSurface = 'search' | 'get_document' | 'query_graph' | 'provenance_chain';
export type GraphDirection = 'in' | 'out' | 'both';

export interface GraphNodeRow {
  chunk_id: string;
  instance_id: string;
  document_id: string;
  document_path: string;
  document_title: string;
  document_status: GraphDocumentStatus;
  heading_path: string;
  breadcrumb: string;
  provenance_basis: string | null;
  question_status: string | null;
  question_resolution: string | null;
  community_id: string | null;
  community_label: string | null;
  community_summary: string | null;
}

export interface GraphEdgeRow {
  id: string;
  instance_id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  relation: string;
  confidence: 'EXTRACTED' | 'INFERRED' | (string & {});
  confidence_score: number;
  reasoning: string | null;
  model: string | null;
  status: 'active' | 'stale' | 'deleted' | (string & {});
  metadata: Record<string, unknown> | null;
}

export interface GraphDocumentPayload {
  id: string;
  path: string;
  title: string;
  status: GraphDocumentStatus;
}

export interface GraphNodePayload {
  chunk_id: string;
  document: GraphDocumentPayload;
  heading_path: string;
  breadcrumb: string;
  provenance_basis: string | null;
  question_status: string | null;
  question_resolution: string | null;
  community_id: string | null;
  community_label: string | null;
  community_summary: string | null;
}

export interface GraphEdgePayload {
  id: string;
  source: GraphNodePayload;
  target: GraphNodePayload;
  relation: string;
  direction: GraphDirection;
  confidence: string;
  confidence_score: number;
  reasoning: string | null;
  model: string | null;
  stale: boolean;
  metadata: Record<string, unknown>;
}

export interface GraphQueryStoreSeed {
  nodes: GraphNodeRow[];
  edges: GraphEdgeRow[];
}

export interface GraphQueryStore {
  listNodes(instanceId: string): Promise<GraphNodeRow[]>;
  listEdges(instanceId: string): Promise<GraphEdgeRow[]>;
}

export interface PgLikeClient {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface GraphQueryInput {
  instance_id: string;
  action: string;
  chunk_id?: string;
  from?: string;
  to?: string;
  relations?: string[];
  direction?: GraphDirection;
  max_depth?: number;
  max_hops?: number;
  include_stale?: boolean;
  include_resolved?: boolean;
  document_status?: GraphDocumentStatus;
  limit?: number;
  confidence_threshold?: number;
  community_id?: string;
  min_members?: number;
}

export interface GraphQueryContext {
  relations?: GraphRelationDefinition[];
  graph?: {
    enabled?: boolean;
    similarity_mode?: string;
    similarity_threshold?: number;
    similarity_percentile?: number;
    classification_enabled?: boolean;
    communities?: string;
  };
}

const GRAPH_ACTIONS = new Set<GraphAction>([
  'node',
  'edges',
  'neighbors',
  'path',
  'subgraph',
  'stats',
  'schema',
  'contradictions',
  'impact',
  'provenance_chain',
  'weak_paths',
  'ungrounded_edges',
  'community_for',
  'community_members',
  'list_communities',
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const DEFAULT_DEPTH = 1;
const MAX_DEPTH = 5;

export function createInMemoryGraphQueryStore(seed: GraphQueryStoreSeed): GraphQueryStore {
  return {
    listNodes(instanceId: string): Promise<GraphNodeRow[]> {
      return Promise.resolve(seed.nodes.filter((node) => node.instance_id === instanceId));
    },
    listEdges(instanceId: string): Promise<GraphEdgeRow[]> {
      return Promise.resolve(seed.edges.filter((edge) => edge.instance_id === instanceId));
    },
  };
}

export function createPgGraphQueryStore(client: PgLikeClient): GraphQueryStore {
  return {
    async listNodes(instanceId: string): Promise<GraphNodeRow[]> {
      const result = await client.query<GraphNodeRow>(
        `
        SELECT
          n.chunk_id::text,
          n.instance_id,
          c.document_id::text,
          d.path AS document_path,
          d.title AS document_title,
          d.status AS document_status,
          c.heading_path,
          c.breadcrumb,
          n.provenance_basis,
          n.question_status,
          n.question_resolution,
          n.community_id,
          n.community_label,
          n.community_summary
        FROM fqc_graph_nodes n
        JOIN fqc_chunks c
          ON c.id = n.chunk_id
         AND c.instance_id = n.instance_id
        JOIN fqc_documents d
          ON d.id = c.document_id
         AND d.instance_id = n.instance_id
        WHERE n.instance_id = $1
        ORDER BY d.path, c.chunk_index, n.chunk_id
        `,
        [instanceId]
      );
      return result.rows;
    },
    async listEdges(instanceId: string): Promise<GraphEdgeRow[]> {
      const result = await client.query<GraphEdgeRow>(
        `
        SELECT
          id::text,
          instance_id,
          source_chunk_id::text,
          target_chunk_id::text,
          relation,
          confidence,
          confidence_score::float8 AS confidence_score,
          reasoning,
          model,
          status,
          metadata
        FROM fqc_graph_edges
        WHERE instance_id = $1
        ORDER BY created_at, id
        `,
        [instanceId]
      );
      return result.rows;
    },
  };
}

export async function queryGraph(
  store: GraphQueryStore,
  input: GraphQueryInput,
  context: GraphQueryContext = {}
): Promise<ToolResult> {
  if (!GRAPH_ACTIONS.has(input.action as GraphAction)) {
    return graphExpectedError({
      action: input.action,
      code: 'graph_invalid_action',
      message: `Unsupported graph query action '${input.action}'`,
    });
  }

  const action = input.action as GraphAction;
  const missing = requiredParameter(action, input);
  if (missing) {
    return graphExpectedError({
      action,
      code: 'graph_missing_parameter',
      message: `Graph query action '${action}' requires '${missing}'`,
      details: { parameter: missing },
    });
  }

  try {
    const rows = filterLoadedRowsForAction(await loadPayloadRows(store, input.instance_id), action, input);
    const limit = clampLimit(input.limit);
    const relations = context.relations ?? DEFAULT_GRAPH_RELATIONS;

    switch (action) {
      case 'node':
        return graphToolResult(action, nodeAction(rows, input));
      case 'edges':
        return graphToolResult(action, edgesAction(rows, input, relations, limit));
      case 'neighbors':
        return graphToolResult(action, traversalAction(rows, input, relations, limit, 'neighbors'));
      case 'path':
        return graphToolResult(action, pathAction(rows, input, relations, limit));
      case 'subgraph':
        return graphToolResult(action, traversalAction(rows, input, relations, limit, 'subgraph'));
      case 'stats':
        return graphToolResult(action, statsAction(rows));
      case 'schema':
        return graphToolResult(action, schemaAction(relations, context));
      case 'contradictions':
        return graphToolResult(action, contradictionsAction(rows, input, relations, limit));
      case 'impact':
        return graphToolResult(action, traversalAction(rows, { ...input, direction: 'out' }, relations, limit, 'impact'));
      case 'provenance_chain':
        return graphToolResult(action, provenanceChainAction(rows, input, relations, limit));
      case 'weak_paths':
        return graphToolResult(action, weakPathsAction(rows, input, relations, limit));
      case 'ungrounded_edges':
        return graphToolResult(action, ungroundedEdgesAction(rows, input, relations, limit));
      case 'community_for':
        return graphToolResult(action, communityForAction(rows, input));
      case 'community_members':
        return graphToolResult(action, communityMembersAction(rows, input, limit));
      case 'list_communities':
        return graphToolResult(action, listCommunitiesAction(rows, input, limit));
    }
  } catch (err: unknown) {
    return graphRuntimeError({
      action,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function filterGraphNodesForSurface(
  nodes: GraphNodePayload[],
  surface: GraphSurface,
  options: { include_inactive?: boolean; document_status?: GraphDocumentStatus } = {}
): GraphNodePayload[] {
  if (options.document_status) {
    return nodes.filter((node) => node.document.status === options.document_status);
  }
  if (surface === 'query_graph' || surface === 'provenance_chain' || options.include_inactive) {
    return nodes;
  }
  return nodes.filter((node) => node.document.status === 'active');
}

export function filterGraphEdgesForSurface(
  edges: GraphEdgePayload[],
  surface: GraphSurface,
  options: { include_inactive?: boolean; include_inactive_targets?: boolean; document_status?: GraphDocumentStatus } = {}
): GraphEdgePayload[] {
  if (surface === 'provenance_chain') {
    return edges;
  }
  if (surface === 'get_document' && !options.include_inactive_targets) {
    return edges.filter((edge) => edge.target.document.status === 'active');
  }
  if (surface === 'search' && !options.include_inactive) {
    return edges.filter(
      (edge) => edge.source.document.status === 'active' && edge.target.document.status === 'active'
    );
  }
  if (surface === 'query_graph' && options.document_status) {
    return edges.filter(
      (edge) =>
        edge.source.document.status === options.document_status ||
        edge.target.document.status === options.document_status
    );
  }
  return edges;
}

interface LoadedGraphRows {
  nodes: GraphNodePayload[];
  edges: GraphEdgePayload[];
}

function filterLoadedRowsForAction(
  rows: LoadedGraphRows,
  action: GraphAction,
  input: GraphQueryInput
): LoadedGraphRows {
  if (!input.document_status || action === 'provenance_chain') {
    return rows;
  }
  return {
    nodes: filterGraphNodesForSurface(rows.nodes, 'query_graph', {
      document_status: input.document_status,
    }),
    edges: filterGraphEdgesForSurface(rows.edges, 'query_graph', {
      document_status: input.document_status,
    }),
  };
}

async function loadPayloadRows(store: GraphQueryStore, instanceId: string): Promise<LoadedGraphRows> {
  const nodeRows = await store.listNodes(instanceId);
  const nodeMap = new Map(nodeRows.map((row) => [row.chunk_id, toNodePayload(row)]));
  const edgeRows = await store.listEdges(instanceId);
  const edges = edgeRows.flatMap((row) => {
    const source = nodeMap.get(row.source_chunk_id);
    const target = nodeMap.get(row.target_chunk_id);
    if (!source || !target) return [];
    return [toEdgePayload(row, source, target, 'out')];
  });
  return { nodes: [...nodeMap.values()], edges };
}

function toNodePayload(row: GraphNodeRow): GraphNodePayload {
  return {
    chunk_id: row.chunk_id,
    document: {
      id: row.document_id,
      path: row.document_path,
      title: row.document_title,
      status: row.document_status,
    },
    heading_path: row.heading_path,
    breadcrumb: row.breadcrumb,
    provenance_basis: row.provenance_basis,
    question_status: row.question_status,
    question_resolution: row.question_resolution,
    community_id: row.community_id,
    community_label: row.community_label,
    community_summary: row.community_summary,
  };
}

function toEdgePayload(
  row: GraphEdgeRow,
  source: GraphNodePayload,
  target: GraphNodePayload,
  direction: GraphDirection
): GraphEdgePayload {
  return {
    id: row.id,
    source,
    target,
    relation: row.relation,
    direction,
    confidence: row.confidence,
    confidence_score: row.confidence_score,
    reasoning: row.reasoning,
    model: row.model,
    stale: row.status === 'stale',
    metadata: row.metadata ?? {},
  };
}

function requiredParameter(action: GraphAction, input: GraphQueryInput): string | null {
  if (
    ['node', 'neighbors', 'subgraph', 'impact', 'provenance_chain', 'community_for'].includes(action) &&
    !input.chunk_id
  ) {
    return 'chunk_id';
  }
  if (action === 'path' && !input.from) return 'from';
  if (action === 'path' && !input.to) return 'to';
  if (action === 'community_members' && !input.community_id && !input.chunk_id) {
    return 'community_id';
  }
  return null;
}

function nodeAction(rows: LoadedGraphRows, input: GraphQueryInput): { node: GraphNodePayload | null } {
  const node = rows.nodes.find((candidate) => candidate.chunk_id === input.chunk_id) ?? null;
  return { node };
}

function edgesAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  relations: GraphRelationDefinition[],
  limit: number
): { edges: GraphEdgePayload[] } {
  return {
    edges: relationAndStatusFilteredEdges(rows.edges, input, relations)
      .filter((edge) => {
        if (!input.chunk_id) return true;
        return edge.source.chunk_id === input.chunk_id || edge.target.chunk_id === input.chunk_id;
      })
      .slice(0, limit),
  };
}

function traversalAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  relations: GraphRelationDefinition[],
  limit: number,
  mode: 'neighbors' | 'subgraph' | 'impact'
): { root: string; nodes: GraphNodePayload[]; edges: GraphEdgePayload[]; max_depth: number } {
  const root = input.chunk_id ?? '';
  const maxDepth = clampDepth(input.max_depth);
  const direction = input.direction ?? 'both';
  const includedNodes = new Map<string, GraphNodePayload>();
  const includedEdges = new Map<string, GraphEdgePayload>();
  const queue: Array<{ chunkId: string; depth: number }> = [{ chunkId: root, depth: 0 }];
  const visited = new Set<string>();

  const rootNode = rows.nodes.find((node) => node.chunk_id === root);
  if (rootNode) includedNodes.set(rootNode.chunk_id, rootNode);

  while (queue.length > 0 && includedNodes.size < limit) {
    const current = queue.shift();
    if (!current || visited.has(current.chunkId) || current.depth >= maxDepth) continue;
    visited.add(current.chunkId);

    for (const edge of adjacentEdges(rows.edges, current.chunkId, direction, relations, input)) {
      const next = edge.source.chunk_id === current.chunkId ? edge.target : edge.source;
      includedEdges.set(edge.id, orientedEdge(edge, current.chunkId));
      includedNodes.set(next.chunk_id, next);
      if (!visited.has(next.chunk_id)) {
        queue.push({ chunkId: next.chunk_id, depth: current.depth + 1 });
      }
      if (mode === 'neighbors' && current.depth + 1 >= maxDepth) continue;
    }
  }

  return {
    root,
    nodes: [...includedNodes.values()].slice(0, limit),
    edges: [...includedEdges.values()].slice(0, limit),
    max_depth: maxDepth,
  };
}

function pathAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  relations: GraphRelationDefinition[],
  limit: number
): { found: boolean; nodes: GraphNodePayload[]; edges: GraphEdgePayload[]; max_hops: number } {
  const from = input.from ?? '';
  const to = input.to ?? '';
  const maxHops = clampDepth(input.max_hops ?? input.max_depth);
  const queue: Array<{ chunkId: string; edgeIds: string[]; nodeIds: string[] }> = [
    { chunkId: from, edgeIds: [], nodeIds: [from] },
  ];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.chunkId) || current.edgeIds.length >= maxHops) continue;
    visited.add(current.chunkId);
    for (const edge of adjacentEdges(rows.edges, current.chunkId, input.direction ?? 'both', relations, input)) {
      const nextId = edge.source.chunk_id === current.chunkId ? edge.target.chunk_id : edge.source.chunk_id;
      const nextPath = {
        chunkId: nextId,
        edgeIds: [...current.edgeIds, edge.id],
        nodeIds: [...current.nodeIds, nextId],
      };
      if (nextId === to) {
        return {
          found: true,
          nodes: nextPath.nodeIds
            .map((id) => rows.nodes.find((node) => node.chunk_id === id))
            .filter((node): node is GraphNodePayload => node !== undefined),
          edges: nextPath.edgeIds
            .map((id) => rows.edges.find((edge) => edge.id === id))
            .filter((edge): edge is GraphEdgePayload => edge !== undefined),
          max_hops: maxHops,
        };
      }
      if (nextPath.nodeIds.length <= limit) queue.push(nextPath);
    }
  }

  return { found: false, nodes: [], edges: [], max_hops: maxHops };
}

function statsAction(rows: LoadedGraphRows): {
  node_count: number;
  edge_count: number;
  by_relation: Record<string, number>;
  by_document_status: Record<string, number>;
} {
  return {
    node_count: rows.nodes.length,
    edge_count: rows.edges.length,
    by_relation: countBy(rows.edges, (edge) => edge.relation),
    by_document_status: countBy(rows.nodes, (node) => node.document.status),
  };
}

function schemaAction(
  relations: GraphRelationDefinition[],
  context: GraphQueryContext
): {
  relations: Array<{
    name: string;
    category: string;
    directionality: string;
    detection_method: string;
    description: string;
  }>;
  features: {
    enabled: boolean;
    similarity_mode: string;
    similarity_threshold: number;
    similarity_percentile: number;
    classification_enabled: boolean;
    communities: string;
  };
} {
  return {
    relations: relations.map((relation) => ({
      name: relation.name,
      category: relation.category,
      directionality: relation.directionality,
      detection_method: relation.detectionMethod,
      description: relation.description,
    })),
    features: {
      enabled: context.graph?.enabled ?? true,
      similarity_mode: context.graph?.similarity_mode ?? 'threshold',
      similarity_threshold: context.graph?.similarity_threshold ?? 0.78,
      similarity_percentile: context.graph?.similarity_percentile ?? 95,
      classification_enabled: context.graph?.classification_enabled ?? false,
      communities: context.graph?.communities ?? 'seeded_read_only',
    },
  };
}

function contradictionsAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  relations: GraphRelationDefinition[],
  limit: number
): { edges: GraphEdgePayload[] } {
  return {
    edges: relationAndStatusFilteredEdges(
      rows.edges,
      {
        ...input,
        relations: ['contradicts'],
        include_stale: input.include_resolved === true,
      },
      relations
    ).slice(0, limit),
  };
}

function provenanceChainAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  relations: GraphRelationDefinition[],
  limit: number
): { root: string; chain: GraphEdgePayload[]; nodes: GraphNodePayload[] } {
  const root = input.chunk_id ?? '';
  const maxDepth = clampDepth(input.max_depth);
  const queue: Array<{ chunkId: string; depth: number }> = [{ chunkId: root, depth: 0 }];
  const visited = new Set<string>();
  const chain = new Map<string, GraphEdgePayload>();
  const nodes = new Map<string, GraphNodePayload>();
  const rootNode = rows.nodes.find((node) => node.chunk_id === root);
  if (rootNode) nodes.set(rootNode.chunk_id, rootNode);

  while (queue.length > 0 && chain.size < limit) {
    const current = queue.shift();
    if (!current || visited.has(current.chunkId) || current.depth >= maxDepth) continue;
    visited.add(current.chunkId);
    const incoming = adjacentEdges(rows.edges, current.chunkId, 'in', relations, {
      ...input,
      include_stale: true,
    }).sort(provenanceEdgeSort);
    for (const edge of incoming) {
      chain.set(edge.id, edge);
      nodes.set(edge.source.chunk_id, edge.source);
      nodes.set(edge.target.chunk_id, edge.target);
      queue.push({ chunkId: edge.source.chunk_id, depth: current.depth + 1 });
    }
  }

  return { root, chain: [...chain.values()], nodes: [...nodes.values()] };
}

function weakPathsAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  relations: GraphRelationDefinition[],
  limit: number
): {
  threshold: number;
  paths: Array<{
    nodes: GraphNodePayload[];
    edges: GraphEdgePayload[];
    weakest_confidence_score: number;
  }>;
  edges: GraphEdgePayload[];
} {
  const threshold = input.confidence_threshold ?? 0.7;
  const edges = relationAndStatusFilteredEdges(rows.edges, input, relations)
    .filter((edge) => edge.confidence_score < threshold)
    .slice(0, limit);
  return {
    threshold,
    paths: edges.map((edge) => ({
      nodes: [edge.source, edge.target],
      edges: [edge],
      weakest_confidence_score: edge.confidence_score,
    })),
    edges,
  };
}

function ungroundedEdgesAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  relations: GraphRelationDefinition[],
  limit: number
): { edges: GraphEdgePayload[] } {
  const structuralRelations = new Set(
    relations
      .filter((relation) => relation.detectionMethod === 'structural' || relation.category === 'structural')
      .map((relation) => relation.name)
  );
  return {
    edges: relationAndStatusFilteredEdges(rows.edges, input, relations)
      .filter((edge) => !structuralRelations.has(edge.relation))
      .filter((edge) => edge.source.provenance_basis === null || edge.target.provenance_basis === null)
      .slice(0, limit),
  };
}

function communityForAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput
): { chunk_id: string; community: null | { community_id: string; community_label: string | null; community_summary: string | null; member_count: number } } {
  const node = rows.nodes.find((candidate) => candidate.chunk_id === input.chunk_id);
  if (!node?.community_id) {
    return { chunk_id: input.chunk_id ?? '', community: null };
  }
  return {
    chunk_id: node.chunk_id,
    community: {
      community_id: node.community_id,
      community_label: node.community_label,
      community_summary: node.community_summary,
      member_count: rows.nodes.filter((candidate) => candidate.community_id === node.community_id).length,
    },
  };
}

function communityMembersAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  limit: number
): { community_id: string | null; members: GraphNodePayload[] } {
  const communityId =
    input.community_id ??
    rows.nodes.find((candidate) => candidate.chunk_id === input.chunk_id)?.community_id ??
    null;
  return {
    community_id: communityId,
    members: communityId
      ? rows.nodes.filter((node) => node.community_id === communityId).slice(0, limit)
      : [],
  };
}

function listCommunitiesAction(
  rows: LoadedGraphRows,
  input: GraphQueryInput,
  limit: number
): {
  communities: Array<{
    community_id: string;
    community_label: string | null;
    community_summary: string | null;
    member_count: number;
    strength_score: number;
    edge_density: number;
    avg_internal_confidence: number;
    provenance_coverage: number;
    sparse: boolean;
    representative_members: GraphNodePayload[];
  }>;
} {
  const grouped = new Map<string, GraphNodePayload[]>();
  for (const node of rows.nodes) {
    if (!node.community_id) continue;
    const group = grouped.get(node.community_id) ?? [];
    group.push(node);
    grouped.set(node.community_id, group);
  }

  const minMembers = input.min_members ?? 1;
  return {
    communities: [...grouped.entries()]
      .map(([communityId, members]) => communityReadSummary(rows.edges, communityId, members))
      .filter((community) => community.member_count >= minMembers)
      .sort((left, right) => right.member_count - left.member_count || left.community_id.localeCompare(right.community_id))
      .slice(0, limit),
  };
}

function communityReadSummary(
  edges: GraphEdgePayload[],
  communityId: string,
  members: GraphNodePayload[]
): {
  community_id: string;
  community_label: string | null;
  community_summary: string | null;
  member_count: number;
  strength_score: number;
  edge_density: number;
  avg_internal_confidence: number;
  provenance_coverage: number;
  sparse: boolean;
  representative_members: GraphNodePayload[];
} {
  const memberIds = new Set(members.map((member) => member.chunk_id));
  const internalEdges = edges.filter(
    (edge) => memberIds.has(edge.source.chunk_id) && memberIds.has(edge.target.chunk_id) && !edge.stale
  );
  const possibleEdges = members.length * (members.length - 1);
  const edgeDensity = possibleEdges === 0 ? 0 : internalEdges.length / possibleEdges;
  const avgConfidence = internalEdges.length === 0
    ? 0
    : internalEdges.reduce((sum, edge) => sum + edge.confidence_score, 0) / internalEdges.length;
  const provenanceEdges = internalEdges.filter((edge) => edge.relation === 'supports' || edge.relation === 'references');
  const provenanceCoverage = internalEdges.length === 0 ? 0 : provenanceEdges.length / internalEdges.length;
  const strengthScore = edgeDensity * avgConfidence * Math.max(provenanceCoverage, 0.25);
  return {
    community_id: communityId,
    community_label: members.find((member) => member.community_label)?.community_label ?? null,
    community_summary: members.find((member) => member.community_summary)?.community_summary ?? null,
    member_count: members.length,
    strength_score: roundedMetric(strengthScore),
    edge_density: roundedMetric(edgeDensity),
    avg_internal_confidence: roundedMetric(avgConfidence),
    provenance_coverage: roundedMetric(provenanceCoverage),
    sparse: edgeDensity < 0.34,
    representative_members: members.slice(0, Math.min(3, members.length)),
  };
}

function roundedMetric(value: number): number {
  return Number(value.toFixed(4));
}

function relationAndStatusFilteredEdges(
  edges: GraphEdgePayload[],
  input: GraphQueryInput,
  relations: GraphRelationDefinition[]
): GraphEdgePayload[] {
  const allowedRelations = new Set(input.relations ?? relations.map((relation) => relation.name));
  return edges.filter((edge) => {
    if (!allowedRelations.has(edge.relation)) return false;
    if (!input.include_stale && edge.stale) return false;
    if (input.document_status) {
      return (
        edge.source.document.status === input.document_status ||
        edge.target.document.status === input.document_status
      );
    }
    return true;
  });
}

function adjacentEdges(
  edges: GraphEdgePayload[],
  chunkId: string,
  direction: GraphDirection,
  relations: GraphRelationDefinition[],
  input: GraphQueryInput
): GraphEdgePayload[] {
  const symmetric = new Set(
    relations.filter((relation) => relation.directionality === 'symmetric').map((relation) => relation.name)
  );
  return relationAndStatusFilteredEdges(edges, input, relations).filter((edge) => {
    const isSymmetric = symmetric.has(edge.relation);
    if (direction === 'out') {
      return edge.source.chunk_id === chunkId || (isSymmetric && edge.target.chunk_id === chunkId);
    }
    if (direction === 'in') {
      return edge.target.chunk_id === chunkId || (isSymmetric && edge.source.chunk_id === chunkId);
    }
    return edge.source.chunk_id === chunkId || edge.target.chunk_id === chunkId;
  });
}

function orientedEdge(edge: GraphEdgePayload, fromChunkId: string): GraphEdgePayload {
  if (edge.source.chunk_id === fromChunkId) {
    return { ...edge, direction: 'out' };
  }
  if (edge.target.chunk_id === fromChunkId) {
    return { ...edge, direction: 'in' };
  }
  return edge;
}

function provenanceEdgeSort(left: GraphEdgePayload, right: GraphEdgePayload): number {
  const confidenceRank = (edge: GraphEdgePayload): number => (edge.confidence === 'EXTRACTED' ? 0 : 1);
  return (
    confidenceRank(left) - confidenceRank(right) ||
    Number(left.stale) - Number(right.stale) ||
    right.confidence_score - left.confidence_score ||
    left.id.localeCompare(right.id)
  );
}

function clampDepth(depth: number | undefined): number {
  if (depth === undefined) return DEFAULT_DEPTH;
  return Math.max(0, Math.min(Math.trunc(depth), MAX_DEPTH));
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.max(0, Math.min(Math.trunc(limit), MAX_LIMIT));
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
