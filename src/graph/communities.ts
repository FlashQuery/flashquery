import type { PgLikeClient } from './queries.js';

export interface CommunityNodeRow {
  chunk_id: string;
  document_id: string;
  document_path: string;
}

export interface CommunityEdgeRow {
  source_chunk_id: string;
  target_chunk_id: string;
  confidence_score: number;
  status: string;
  relation: string;
}

export interface DetectedCommunity {
  community_id: string;
  community_label: string;
  community_summary: string;
  member_chunk_ids: string[];
  document_ids: string[];
  document_paths: string[];
  strength_score: number;
  edge_density: number;
  avg_internal_confidence: number;
  provenance_coverage: number;
  sparse: boolean;
}

const MIN_COMMUNITY_MEMBERS = 3;
const MIN_INTERNAL_EDGES = 2;

export function detectTopologyCommunities(input: {
  nodes: CommunityNodeRow[];
  edges: CommunityEdgeRow[];
}): DetectedCommunity[] {
  const activeEdges = input.edges.filter((edge) => edge.status === 'active');
  const adjacency = new Map<string, Set<string>>();
  for (const node of input.nodes) adjacency.set(node.chunk_id, new Set());
  for (const edge of activeEdges) {
    adjacency.get(edge.source_chunk_id)?.add(edge.target_chunk_id);
    adjacency.get(edge.target_chunk_id)?.add(edge.source_chunk_id);
  }

  const byChunk = new Map(input.nodes.map((node) => [node.chunk_id, node]));
  const visited = new Set<string>();
  const communities: DetectedCommunity[] = [];

  for (const node of [...input.nodes].sort((a, b) => a.chunk_id.localeCompare(b.chunk_id))) {
    if (visited.has(node.chunk_id)) continue;
    const stack = [node.chunk_id];
    const members: string[] = [];
    visited.add(node.chunk_id);
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      members.push(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    const memberSet = new Set(members);
    const internalEdges = activeEdges.filter(
      (edge) => memberSet.has(edge.source_chunk_id) && memberSet.has(edge.target_chunk_id)
    );
    if (members.length < MIN_COMMUNITY_MEMBERS || internalEdges.length < MIN_INTERNAL_EDGES) continue;

    const possibleEdges = members.length * (members.length - 1);
    const edgeDensity = possibleEdges === 0 ? 0 : internalEdges.length / possibleEdges;
    const avgConfidence = internalEdges.reduce((sum, edge) => sum + edge.confidence_score, 0) / internalEdges.length;
    const provenanceEdges = internalEdges.filter((edge) => edge.relation === 'supports' || edge.relation === 'references');
    const provenanceCoverage = internalEdges.length === 0 ? 0 : provenanceEdges.length / internalEdges.length;
    const documentIds = [...new Set(members.map((id) => byChunk.get(id)?.document_id).filter(isString))].sort();
    const documentPaths = [...new Set(members.map((id) => byChunk.get(id)?.document_path).filter(isString))].sort();
    const communityId = `comm-${communities.length + 1}-${members.sort()[0]?.slice(0, 8) ?? 'graph'}`;
    const strengthScore = Number((edgeDensity * avgConfidence * Math.max(provenanceCoverage, 0.25)).toFixed(4));

    communities.push({
      community_id: communityId,
      community_label: `Graph Community ${communities.length + 1}`,
      community_summary: `${members.length} chunks connected by ${internalEdges.length} stored topology edges.`,
      member_chunk_ids: members.sort(),
      document_ids: documentIds,
      document_paths: documentPaths,
      strength_score: strengthScore,
      edge_density: Number(edgeDensity.toFixed(4)),
      avg_internal_confidence: Number(avgConfidence.toFixed(4)),
      provenance_coverage: Number(provenanceCoverage.toFixed(4)),
      sparse: edgeDensity < 0.34,
    });
  }

  return communities;
}

export async function detectAndApplyTopologyCommunities(options: {
  client: PgLikeClient;
  instanceId: string;
  pathPrefix?: string;
  dryRun?: boolean;
}): Promise<DetectedCommunity[]> {
  const nodesResult = await options.client.query<CommunityNodeRow>(
    `
    SELECT n.chunk_id::text, d.id::text AS document_id, d.path AS document_path
    FROM fqc_graph_nodes n
    JOIN fqc_chunks c ON c.id = n.chunk_id
    JOIN fqc_documents d ON d.id = c.document_id
    WHERE n.instance_id = $1
      AND ($2::text IS NULL OR d.path LIKE $2::text || '%')
    ORDER BY n.chunk_id
    `,
    [options.instanceId, options.pathPrefix ?? null]
  );
  const edgesResult = await options.client.query<CommunityEdgeRow>(
    `
    SELECT e.source_chunk_id::text, e.target_chunk_id::text, e.confidence_score, e.status, e.relation
    FROM fqc_graph_edges e
    JOIN fqc_chunks sc ON sc.id = e.source_chunk_id
    JOIN fqc_documents sd ON sd.id = sc.document_id
    JOIN fqc_chunks tc ON tc.id = e.target_chunk_id
    JOIN fqc_documents td ON td.id = tc.document_id
    WHERE e.instance_id = $1
      AND ($2::text IS NULL OR sd.path LIKE $2::text || '%' OR td.path LIKE $2::text || '%')
    ORDER BY e.id
    `,
    [options.instanceId, options.pathPrefix ?? null]
  );

  const communities = detectTopologyCommunities({ nodes: nodesResult.rows, edges: edgesResult.rows });
  if (options.dryRun === true) return communities;

  await options.client.query(
    `
    UPDATE fqc_graph_nodes n
    SET community_id = NULL,
        community_label = NULL,
        community_summary = NULL,
        updated_at = now()
    FROM fqc_chunks c
    JOIN fqc_documents d ON d.id = c.document_id
    WHERE n.chunk_id = c.id
      AND n.instance_id = $1
      AND ($2::text IS NULL OR d.path LIKE $2::text || '%')
    `,
    [options.instanceId, options.pathPrefix ?? null]
  );

  for (const community of communities) {
    await options.client.query(
      `
      UPDATE fqc_graph_nodes
      SET community_id = $3,
          community_label = $4,
          community_summary = $5,
          updated_at = now()
      WHERE instance_id = $1
        AND chunk_id = ANY($2::uuid[])
      `,
      [
        options.instanceId,
        community.member_chunk_ids,
        community.community_id,
        community.community_label,
        community.community_summary,
      ]
    );
  }

  return communities;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
