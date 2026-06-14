import pg from 'pg';
import { parseDocumentChunks } from './parser.js';
import type { ChunkParserParams, ParsedChunk } from './types.js';

export interface ExistingDocumentChunkRow {
  id: string;
  content_hash: string;
}

export interface DocumentChunkDiff {
  newChunks: ParsedChunk[];
  changedChunks: ParsedChunk[];
  unchangedChunks: ParsedChunk[];
  orphanChunks: ExistingDocumentChunkRow[];
  chunksNeedingEmbedding: ParsedChunk[];
}

export type ChunkStoreOperationKind = 'begin' | 'select' | 'insert' | 'update' | 'delete' | 'commit';

export interface ChunkStoreOperation {
  kind: ChunkStoreOperationKind;
  count: number;
}

export interface ChunkStorePgClient {
  connect?(): Promise<unknown>;
  end?(): Promise<void>;
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface DiffAndPersistDocumentChunksOptions {
  databaseUrl?: string;
  client?: ChunkStorePgClient;
  instanceId: string;
  documentId: string;
  title: string;
  body: string;
  params?: Partial<ChunkParserParams>;
}

export interface DiffAndPersistDocumentChunksResult extends DocumentChunkDiff {
  chunks: ParsedChunk[];
  operations: ChunkStoreOperation[];
}

export function classifyDocumentChunkDiff(
  existingRows: ExistingDocumentChunkRow[],
  parsedChunks: ParsedChunk[]
): DocumentChunkDiff {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const parsedIds = new Set(parsedChunks.map((chunk) => chunk.id));
  const newChunks: ParsedChunk[] = [];
  const changedChunks: ParsedChunk[] = [];
  const unchangedChunks: ParsedChunk[] = [];

  for (const chunk of parsedChunks) {
    const existing = existingById.get(chunk.id);
    if (!existing) {
      newChunks.push(chunk);
    } else if (existing.content_hash !== chunk.content_hash) {
      changedChunks.push(chunk);
    } else {
      unchangedChunks.push(chunk);
    }
  }

  const orphanChunks = existingRows.filter((row) => !parsedIds.has(row.id));

  return {
    newChunks,
    changedChunks,
    unchangedChunks,
    orphanChunks,
    chunksNeedingEmbedding: parsedChunks.filter((chunk) => {
      const existing = existingById.get(chunk.id);
      return !existing || existing.content_hash !== chunk.content_hash;
    }),
  };
}

export function planDocumentChunkPersistence(diff: DocumentChunkDiff): ChunkStoreOperation[] {
  return [
    { kind: 'begin', count: 1 },
    { kind: 'select', count: 1 },
    { kind: 'insert', count: diff.newChunks.length },
    { kind: 'update', count: diff.changedChunks.length },
    { kind: 'delete', count: diff.orphanChunks.length },
    { kind: 'commit', count: 1 },
  ];
}

export async function diffAndPersistDocumentChunks(
  options: DiffAndPersistDocumentChunksOptions
): Promise<DiffAndPersistDocumentChunksResult> {
  const parsedChunks = parseDocumentChunks({
    instanceId: options.instanceId,
    documentId: options.documentId,
    title: options.title,
    body: options.body,
    params: options.params,
  });

  const ownsClient = !options.client;
  const client = options.client ?? makePgClient(options.databaseUrl);

  if (client.connect) {
    await client.connect();
  }

  try {
    await client.query('BEGIN');
    const existingRows = await selectExistingChunks(client, options.instanceId, options.documentId);
    const diff = classifyDocumentChunkDiff(existingRows, parsedChunks);
    await insertChunks(client, options.instanceId, diff.newChunks);
    await updateChunks(client, options.instanceId, diff.changedChunks);
    await deleteOrphanChunks(client, options.instanceId, options.documentId, diff.orphanChunks);
    await client.query('COMMIT');

    return {
      chunks: parsedChunks,
      ...diff,
      operations: planDocumentChunkPersistence(diff),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    if (ownsClient && client.end) {
      await client.end();
    }
  }
}

function makePgClient(databaseUrl?: string): ChunkStorePgClient {
  if (!databaseUrl) {
    throw new Error('diffAndPersistDocumentChunks requires databaseUrl or client');
  }
  return new pg.Client({ connectionString: databaseUrl });
}

async function selectExistingChunks(
  client: ChunkStorePgClient,
  instanceId: string,
  documentId: string
): Promise<ExistingDocumentChunkRow[]> {
  const result = await client.query<ExistingDocumentChunkRow>(
    `SELECT id, content_hash
     FROM fqc_chunks
     WHERE instance_id = $1 AND document_id = $2
     FOR UPDATE`,
    [instanceId, documentId]
  );
  return result.rows;
}

async function insertChunks(
  client: ChunkStorePgClient,
  instanceId: string,
  chunks: ParsedChunk[]
): Promise<void> {
  for (const chunk of chunks) {
    await client.query(
      `INSERT INTO fqc_chunks (
         id, instance_id, document_id, heading_path, heading_level, breadcrumb,
         content, content_hash, chunk_index, parent_chunk_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        chunk.id,
        instanceId,
        chunk.document_id,
        toStoredHeadingPath(chunk.heading_path),
        chunk.heading_level,
        chunk.breadcrumb,
        chunk.content,
        chunk.content_hash,
        chunk.chunk_index,
        chunk.parent_chunk_id,
      ]
    );
  }
}

async function updateChunks(
  client: ChunkStorePgClient,
  instanceId: string,
  chunks: ParsedChunk[]
): Promise<void> {
  for (const chunk of chunks) {
    await client.query(
      `UPDATE fqc_chunks
       SET heading_path = $1,
           heading_level = $2,
           breadcrumb = $3,
           content = $4,
           content_hash = $5,
           chunk_index = $6,
           parent_chunk_id = $7,
           updated_at = now()
       WHERE instance_id = $8 AND document_id = $9 AND id = $10`,
      [
        toStoredHeadingPath(chunk.heading_path),
        chunk.heading_level,
        chunk.breadcrumb,
        chunk.content,
        chunk.content_hash,
        chunk.chunk_index,
        chunk.parent_chunk_id,
        instanceId,
        chunk.document_id,
        chunk.id,
      ]
    );
  }
}

async function deleteOrphanChunks(
  client: ChunkStorePgClient,
  instanceId: string,
  documentId: string,
  chunks: ExistingDocumentChunkRow[]
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  await client.query(
    `DELETE FROM fqc_chunks
     WHERE instance_id = $1 AND document_id = $2 AND id = ANY($3::uuid[])`,
    [instanceId, documentId, chunks.map((chunk) => chunk.id)]
  );
}

function toStoredHeadingPath(headingPath: string): string[] {
  return headingPath
    .split(' > ')
    .map((part) => part.trim())
    .filter(Boolean);
}
