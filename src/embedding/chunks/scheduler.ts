import type { FlashQueryConfig } from '../../config/types.js';
import { FM } from '../../constants/frontmatter-fields.js';
import { selectGraphEdgeCandidates } from '../../graph/candidates.js';
import {
  removeDocumentChunkProcessingState,
  removeDocumentGraphState,
} from '../../graph/lifecycle.js';
import { enqueuePendingEdgeCandidates } from '../../graph/pending-edges.js';
import { markChangedChunkGraphEdgesStale } from '../../graph/staleness.js';
import {
  refreshStructuralGraphEdges,
  type GraphPgClient,
  type StructuralGraphDocument,
} from '../../graph/structural.js';
import { createPgClientIPv4 } from '../../utils/pg-client.js';
import {
  documentChunkEmbeddingTarget,
  scheduleBackgroundEmbeddingsForActiveEntries,
} from '../background-embed.js';
import { diffAndPersistDocumentChunks } from './store.js';
import type { ParsedChunk } from './types.js';

interface QueryResult<Row = Record<string, unknown>> {
  data?: Row[] | Row | null;
  error?: { message: string } | null;
}

interface SupabaseLike {
  from(table: string): unknown;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

interface StructuredLogger {
  warn?(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ScheduleChangedDocumentChunksOptions {
  config: FlashQueryConfig;
  supabase: SupabaseLike;
  documentId: string;
  documentPath: string;
  title: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  logger?: StructuredLogger;
}

export type GraphProcessingLevel = 'full' | 'embedded' | 'none';

export interface GraphProcessingDiagnostic {
  code: 'invalid_fq_processing';
  field: typeof FM.PROCESSING;
  message: string;
  value: unknown;
}

export interface ParsedGraphProcessingLevel {
  level: GraphProcessingLevel | null;
  diagnostics: GraphProcessingDiagnostic[];
}

export interface ScheduleChangedDocumentChunksResult {
  warnings: string[];
  processingLevel: GraphProcessingLevel | null;
  processingDiagnostics: GraphProcessingDiagnostic[];
  changedChunkCount: number;
  totalChunkCount: number;
  graphEdgeCount: number;
  graphCandidateCount: number;
  pendingEdgeJobCount: number;
  graphCandidateSkippedCount: number;
}

interface ChunkGraphRow extends ParsedChunk {
  document_path: string;
  document_title: string;
}

const GRAPH_PROCESSING_LEVELS = ['full', 'embedded', 'none'] as const;

export function parseGraphProcessingLevel(frontmatter: Record<string, unknown> = {}): ParsedGraphProcessingLevel {
  const value = frontmatter[FM.PROCESSING];
  if (value === undefined || value === null || value === '') {
    return { level: 'full', diagnostics: [] };
  }
  if (typeof value === 'string' && isGraphProcessingLevel(value)) {
    return { level: value, diagnostics: [] };
  }
  const printable = typeof value === 'string' ? value : JSON.stringify(value);
  return {
    level: null,
    diagnostics: [
      {
        code: 'invalid_fq_processing',
        field: FM.PROCESSING,
        message: `Invalid fq_processing value '${printable}'. Expected one of: full, embedded, none.`,
        value,
      },
    ],
  };
}

export function shouldRunChunksForProcessingLevel(level: GraphProcessingLevel): boolean {
  return level !== 'none';
}

export function shouldRunGraphForProcessingLevel(level: GraphProcessingLevel): boolean {
  return level === 'full';
}

export async function scheduleChangedDocumentChunks(
  options: ScheduleChangedDocumentChunksOptions
): Promise<ScheduleChangedDocumentChunksResult> {
  const processing = parseGraphProcessingLevel(options.frontmatter);
  if (processing.level === null) {
    return {
      warnings: processing.diagnostics.map(
        (diagnostic): `invalid_fq_processing:${string}` => `${diagnostic.code}:${String(diagnostic.value)}`
      ),
      processingLevel: null,
      processingDiagnostics: processing.diagnostics,
      changedChunkCount: 0,
      totalChunkCount: 0,
      graphEdgeCount: 0,
      graphCandidateCount: 0,
      pendingEdgeJobCount: 0,
      graphCandidateSkippedCount: 0,
    };
  }

  if (!shouldRunChunksForProcessingLevel(processing.level)) {
    const client = createPgClientIPv4(options.config.supabase.databaseUrl);
    try {
      await client.connect();
      await removeDocumentChunkProcessingState(client, {
        instanceId: options.config.instance.id,
        documentId: options.documentId,
      });
    } finally {
      await client.end().catch(() => undefined);
    }
    return {
      warnings: [],
      processingLevel: processing.level,
      processingDiagnostics: [],
      changedChunkCount: 0,
      totalChunkCount: 0,
      graphEdgeCount: 0,
      graphCandidateCount: 0,
      pendingEdgeJobCount: 0,
      graphCandidateSkippedCount: 0,
    };
  }

  const graphEnabled = options.config.graph?.enabled === true;
  const client = createPgClientIPv4(options.config.supabase.databaseUrl);
  let graphEdgeCount = 0;
  let result: Awaited<ReturnType<typeof diffAndPersistDocumentChunks>>;
  try {
    result = await diffAndPersistDocumentChunks({
      client,
      instanceId: options.config.instance.id,
      documentId: options.documentId,
      title: options.title,
      body: options.body,
    });

    if (!graphEnabled || !shouldRunGraphForProcessingLevel(processing.level)) {
      await removeDocumentGraphState(client, {
        instanceId: options.config.instance.id,
        documentId: options.documentId,
      });
    } else {
      await markChangedChunkGraphEdgesStale(client, {
        instanceId: options.config.instance.id,
        diff: result,
      });
      const documents = await loadStructuralGraphDocuments(client, options.config.instance.id);
      const document = documents.find((candidate) => candidate.documentId === options.documentId) ?? {
        documentId: options.documentId,
        path: options.documentPath,
        title: options.title,
        chunks: result.chunks,
      };
      const graph = await refreshStructuralGraphEdges(client, {
        instanceId: options.config.instance.id,
        document,
        documents,
      });
      graphEdgeCount = graph.edges.length;
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  const results = await Promise.all(
    result.chunksNeedingEmbedding.map((chunk) =>
      scheduleBackgroundEmbeddingsForActiveEntries({
        config: options.config,
        target: documentChunkEmbeddingTarget({
          instanceId: options.config.instance.id,
          id: chunk.id,
          documentPath: options.documentPath,
          headingPath: chunk.heading_path,
        }),
        embedText: chunk.embed_text,
        supabase: options.supabase,
        logger: options.logger,
        databaseUrl: options.config.supabase.databaseUrl,
      })
    )
  );
  const embeddingWarnings = results.flatMap((result) => result.warnings);
  const candidateWork =
    graphEnabled && shouldRunGraphForProcessingLevel(processing.level)
      ? await enqueueGraphCandidateWork({
          config: options.config,
          supabase: options.supabase,
          changedChunkIds: result.chunksNeedingEmbedding.map((chunk) => chunk.id),
          logger: options.logger,
        })
      : emptyGraphCandidateWork();

  return {
    warnings: [...new Set([...embeddingWarnings, ...candidateWork.warnings])],
    processingLevel: processing.level,
    processingDiagnostics: [],
    changedChunkCount: result.chunksNeedingEmbedding.length,
    totalChunkCount: result.chunks.length,
    graphEdgeCount,
    graphCandidateCount: candidateWork.candidateCount,
    pendingEdgeJobCount: candidateWork.pendingEdgeJobCount,
    graphCandidateSkippedCount: candidateWork.skippedCount,
  };
}

function isGraphProcessingLevel(value: string): value is GraphProcessingLevel {
  return (GRAPH_PROCESSING_LEVELS as readonly string[]).includes(value);
}

function emptyGraphCandidateWork(): {
  warnings: string[];
  candidateCount: number;
  pendingEdgeJobCount: number;
  skippedCount: number;
} {
  return {
    warnings: [],
    candidateCount: 0,
    pendingEdgeJobCount: 0,
    skippedCount: 0,
  };
}

async function enqueueGraphCandidateWork(input: {
  config: FlashQueryConfig;
  supabase: SupabaseLike;
  changedChunkIds: string[];
  logger?: StructuredLogger;
}): Promise<ReturnType<typeof emptyGraphCandidateWork>> {
  if (input.changedChunkIds.length === 0) {
    return emptyGraphCandidateWork();
  }

  try {
    const selected = await selectGraphEdgeCandidates({
      supabase: input.supabase,
      instanceId: input.config.instance.id,
      changedChunkIds: input.changedChunkIds,
      graph: input.config.graph,
      relations: input.config.graph?.resolvedRelations,
    });
    if (selected.candidates.length === 0) {
      return {
        warnings: selected.warnings,
        candidateCount: 0,
        pendingEdgeJobCount: 0,
        skippedCount: selected.capExceededCount,
      };
    }

    const enqueued = await enqueuePendingEdgeCandidates({
      supabase: input.supabase,
      instanceId: input.config.instance.id,
      candidates: selected.candidates,
      maxAttempts: input.config.graph?.maxEdgeAttempts,
    });

    return {
      warnings: [...selected.warnings, ...enqueued.warnings],
      candidateCount: selected.candidates.length,
      pendingEdgeJobCount: enqueued.inserted + enqueued.updated,
      skippedCount: selected.capExceededCount + enqueued.skipped,
    };
  } catch (err) {
    const message = errorMessage(err);
    input.logger?.warn?.('graph_candidate_enqueue_failed', { error: message });
    return {
      warnings: [`graph classification enqueue skipped: ${message}`],
      candidateCount: 0,
      pendingEdgeJobCount: 0,
      skippedCount: input.changedChunkIds.length,
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function loadStructuralGraphDocuments(
  client: GraphPgClient,
  instanceId: string
): Promise<StructuralGraphDocument[]> {
  const result = await client.query<ChunkGraphRow>(
    `
    SELECT
      c.id,
      c.document_id,
      c.heading_path,
      c.heading_level,
      c.breadcrumb,
      c.content,
      c.content_hash,
      c.chunk_index,
      c.parent_chunk_id,
      c.content AS embed_text,
      c.heading_path AS source_section_heading_path,
      1 AS source_start_line,
      1 AS source_end_line,
      ARRAY[]::text[] AS merged_heading_paths,
      d.path AS document_path,
      d.title AS document_title
    FROM fqc_chunks c
    JOIN fqc_documents d
      ON d.id = c.document_id
     AND d.instance_id = c.instance_id
    WHERE c.instance_id = $1
    ORDER BY d.path, c.heading_path, c.chunk_index
    `,
    [instanceId]
  );

  const byDocument = new Map<string, StructuralGraphDocument>();
  for (const row of result.rows) {
    const document = byDocument.get(row.document_id) ?? {
      documentId: row.document_id,
      path: row.document_path,
      title: row.document_title,
      chunks: [],
    };
    document.chunks.push({
      id: row.id,
      document_id: row.document_id,
      heading_path: row.heading_path,
      heading_level: row.heading_level,
      breadcrumb: row.breadcrumb,
      content: row.content,
      content_hash: row.content_hash,
      chunk_index: row.chunk_index,
      parent_chunk_id: row.parent_chunk_id,
      embed_text: row.embed_text,
      source_section_heading_path: row.source_section_heading_path,
      source_start_line: row.source_start_line,
      source_end_line: row.source_end_line,
      merged_heading_paths: row.merged_heading_paths,
    });
    byDocument.set(row.document_id, document);
  }
  return [...byDocument.values()];
}
