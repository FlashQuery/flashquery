import type { ParsedChunk } from '../embedding/chunks/types.js';
import { validateGraphEdgeDraft } from './edge-validation.js';
import { resolveChunkReferences, type LinkResolutionDiagnostic } from './link-resolver.js';
import { DEFAULT_GRAPH_RELATIONS } from './vocabulary.js';

export interface GraphPgClient {
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface GraphNodeRow {
  chunk_id: string;
  instance_id: string;
}

export interface StructuralGraphEdgeDraft {
  source_chunk_id: string;
  target_chunk_id: string;
  relation: 'contains' | 'references';
  confidence: 'EXTRACTED';
  confidence_score: 1;
  metadata: Record<string, unknown>;
}

export interface StructuralGraphDocument {
  documentId: string;
  path: string;
  title: string;
  chunks: ParsedChunk[];
}

export interface RefreshStructuralGraphEdgesResult {
  edges: StructuralGraphEdgeDraft[];
  diagnostics: LinkResolutionDiagnostic[];
}

export function buildGraphNodeRows(instanceId: string, chunks: ParsedChunk[]): GraphNodeRow[] {
  return chunks.map((chunk) => ({
    chunk_id: chunk.id,
    instance_id: instanceId,
  }));
}

export function buildContainsEdges(chunks: ParsedChunk[]): StructuralGraphEdgeDraft[] {
  const chunkIds = new Set(chunks.map((chunk) => chunk.id));
  const edges = new Map<string, StructuralGraphEdgeDraft>();

  for (const chunk of chunks) {
    const parentId = chunk.parent_chunk_id ?? inferHeadingParentChunkId(chunk, chunks);
    if (!parentId || !chunkIds.has(parentId)) {
      continue;
    }
    const edge = validateStructuralEdge({
      source_chunk_id: parentId,
      target_chunk_id: chunk.id,
      relation: 'contains',
      confidence: 'EXTRACTED',
      confidence_score: 1,
      metadata: { structural: true },
    });
    edges.set(`${edge.source_chunk_id}:${edge.target_chunk_id}:contains`, edge);
  }

  return [...edges.values()];
}

export async function upsertGraphNodesForChunks(
  client: GraphPgClient,
  options: { instanceId: string; chunks: ParsedChunk[] }
): Promise<void> {
  for (const node of buildGraphNodeRows(options.instanceId, options.chunks)) {
    await client.query(
      `
      INSERT INTO fqc_graph_nodes (chunk_id, instance_id)
      VALUES ($1, $2)
      ON CONFLICT (chunk_id) DO UPDATE
      SET instance_id = EXCLUDED.instance_id,
          updated_at = now()
      WHERE fqc_graph_nodes.instance_id = EXCLUDED.instance_id
      `,
      [node.chunk_id, node.instance_id]
    );
  }
}

export function buildReferenceEdges(options: {
  document: StructuralGraphDocument;
  documents: StructuralGraphDocument[];
}): RefreshStructuralGraphEdgesResult {
  const edges: StructuralGraphEdgeDraft[] = [];
  const diagnostics: LinkResolutionDiagnostic[] = [];

  for (const chunk of options.document.chunks) {
    const resolved = resolveChunkReferences({
      sourceChunk: chunk,
      documents: options.documents,
    });
    edges.push(...resolved.edges.map(validateStructuralEdge));
    diagnostics.push(...resolved.diagnostics);
  }

  return { edges, diagnostics };
}

export async function refreshStructuralGraphEdges(
  client: GraphPgClient,
  options: {
    instanceId: string;
    document: StructuralGraphDocument;
    documents: StructuralGraphDocument[];
  }
): Promise<RefreshStructuralGraphEdgesResult> {
  await upsertGraphNodesForChunks(client, {
    instanceId: options.instanceId,
    chunks: options.document.chunks,
  });

  const containsEdges = buildContainsEdges(options.document.chunks);
  const references = buildReferenceEdges({
    document: options.document,
    documents: options.documents,
  });
  const edges = [...containsEdges, ...references.edges];
  const sourceChunkIds = options.document.chunks.map((chunk) => chunk.id);

  if (sourceChunkIds.length > 0) {
    await client.query(
      `
      DELETE FROM fqc_graph_edges
      WHERE instance_id = $1
        AND relation = ANY($2::text[])
        AND source_chunk_id = ANY($3::uuid[])
      `,
      [options.instanceId, ['contains', 'references'], sourceChunkIds]
    );
  }

  for (const edge of edges) {
    await client.query(
      `
      INSERT INTO fqc_graph_edges (
        instance_id, source_chunk_id, target_chunk_id, relation,
        confidence, confidence_score, metadata, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active')
      `,
      [
        options.instanceId,
        edge.source_chunk_id,
        edge.target_chunk_id,
        edge.relation,
        edge.confidence,
        edge.confidence_score,
        JSON.stringify(edge.metadata),
      ]
    );
  }

  return {
    edges,
    diagnostics: references.diagnostics,
  };
}

function validateStructuralEdge(edge: StructuralGraphEdgeDraft): StructuralGraphEdgeDraft {
  validateGraphEdgeDraft(
    {
      relation: edge.relation,
      confidence: edge.confidence,
      confidenceScore: edge.confidence_score,
      metadata: edge.metadata,
    },
    DEFAULT_GRAPH_RELATIONS
  );
  return edge;
}

function inferHeadingParentChunkId(chunk: ParsedChunk, chunks: ParsedChunk[]): string | null {
  const parts = chunk.heading_path.split(' > ');
  if (parts.length <= 1) {
    return null;
  }
  const parentPath = parts.slice(0, -1).join(' > ');
  return chunks.find((candidate) => candidate.heading_path === parentPath && candidate.chunk_index === 0)?.id ?? null;
}
