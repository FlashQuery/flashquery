import type { GraphPgClient } from './structural.js';

export interface DocumentGraphLifecycleOptions {
  instanceId: string;
  documentId: string;
}

export async function removeDocumentChunkProcessingState(
  client: GraphPgClient,
  options: DocumentGraphLifecycleOptions
): Promise<void> {
  await client.query(
    `
    DELETE FROM fqc_pending_edges
    WHERE instance_id = $1
      AND (
        source_chunk_id IN (
          SELECT id
          FROM fqc_chunks
          WHERE instance_id = $1 AND document_id = $2
        )
        OR target_chunk_id IN (
          SELECT id
          FROM fqc_chunks
          WHERE instance_id = $1 AND document_id = $2
        )
      )
    `,
    [options.instanceId, options.documentId]
  );
  await client.query(
    `
    DELETE FROM fqc_pending_embeds
    WHERE instance_id = $1
      AND target_table = 'fqc_chunks'
      AND target_id IN (
        SELECT id::text
        FROM fqc_chunks
        WHERE instance_id = $1 AND document_id = $2
      )
    `,
    [options.instanceId, options.documentId]
  );
  await client.query(
    `
    DELETE FROM fqc_chunks
    WHERE instance_id = $1 AND document_id = $2
    `,
    [options.instanceId, options.documentId]
  );
}

export async function removeDocumentGraphState(
  client: GraphPgClient,
  options: DocumentGraphLifecycleOptions
): Promise<void> {
  await client.query(
    `
    DELETE FROM fqc_graph_nodes
    WHERE instance_id = $1
      AND chunk_id IN (
        SELECT id
        FROM fqc_chunks
        WHERE instance_id = $1 AND document_id = $2
      )
    `,
    [options.instanceId, options.documentId]
  );
}

export async function markDocumentGraphEdgesStale(
  client: GraphPgClient,
  options: DocumentGraphLifecycleOptions
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `
    UPDATE fqc_graph_edges
    SET status = 'stale',
        updated_at = now()
    WHERE instance_id = $1
      AND status = 'active'
      AND (
        source_chunk_id IN (
          SELECT id
          FROM fqc_chunks
          WHERE instance_id = $1 AND document_id = $2
        )
        OR target_chunk_id IN (
          SELECT id
          FROM fqc_chunks
          WHERE instance_id = $1 AND document_id = $2
        )
      )
    RETURNING id
    `,
    [options.instanceId, options.documentId]
  );
  return result.rows.length;
}
