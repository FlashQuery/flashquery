import type { FlashQueryConfig } from '../../config/types.js';
import {
  documentChunkEmbeddingTarget,
  scheduleBackgroundEmbeddingsForActiveEntries,
  type EmbeddingWarning,
} from '../background-embed.js';
import { diffAndPersistDocumentChunks } from './store.js';

interface SupabaseLike {
  from(table: string): unknown;
}

interface StructuredLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface ScheduleChangedDocumentChunksOptions {
  config: FlashQueryConfig;
  supabase: SupabaseLike;
  documentId: string;
  documentPath: string;
  title: string;
  body: string;
  logger?: StructuredLogger;
}

export interface ScheduleChangedDocumentChunksResult {
  warnings: EmbeddingWarning[];
  changedChunkCount: number;
  totalChunkCount: number;
}

export async function scheduleChangedDocumentChunks(
  options: ScheduleChangedDocumentChunksOptions
): Promise<ScheduleChangedDocumentChunksResult> {
  const diff = await diffAndPersistDocumentChunks({
    databaseUrl: options.config.supabase.databaseUrl,
    instanceId: options.config.instance.id,
    documentId: options.documentId,
    title: options.title,
    body: options.body,
  });

  const results = await Promise.all(
    diff.chunksNeedingEmbedding.map((chunk) =>
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

  return {
    warnings: [...new Set(results.flatMap((result) => result.warnings))],
    changedChunkCount: diff.chunksNeedingEmbedding.length,
    totalChunkCount: diff.chunks.length,
  };
}
