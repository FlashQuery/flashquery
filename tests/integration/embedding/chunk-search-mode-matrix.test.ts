import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  addSearchDocument,
  createEmbeddingSearchHarness,
  destroyEmbeddingSearchHarness,
  parseToolJson,
  type EmbeddingSearchHarness,
} from './search-test-helpers.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';

const ENTRY_PRIMARY = 'chunk_search_primary';
const ENTRY_ANALYSIS = 'chunk_search_analysis';

async function addExtraChunk(input: {
  harness: EmbeddingSearchHarness;
  documentId: string;
  heading: string;
  content: string;
  vectors: Record<string, number[]>;
}): Promise<void> {
  const chunkId = randomUUID();
  await input.harness.client.query(
    `INSERT INTO fqc_chunks (
       id, instance_id, document_id, heading_path, heading_level, breadcrumb,
       content, content_hash, chunk_index
     )
     VALUES ($1, $2, $3, $4, 2, $4, $5, $6, 1)`,
    [chunkId, input.harness.config.instance.id, input.documentId, input.heading, input.content, `hash-${chunkId}`]
  );
  for (const [entryName, vector] of Object.entries(input.vectors)) {
    await input.harness.client.query(
      `UPDATE fqc_chunks
       SET ${pg.escapeIdentifier(`embedding_${entryName}`)} = $1::vector,
           ${pg.escapeIdentifier(`embedding_${entryName}_model`)} = $2,
           ${pg.escapeIdentifier(`embedding_${entryName}_dimensions`)} = $3,
           ${pg.escapeIdentifier(`embedding_${entryName}_provider`)} = 'search-provider',
           ${pg.escapeIdentifier(`embedding_${entryName}_truncated`)} = false,
           ${pg.escapeIdentifier(`embedding_${entryName}_indexed_at`)} = now()
       WHERE id = $4`,
      [`[${vector.join(',')}]`, `model-${entryName}`, vector.length, chunkId]
    );
  }
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk search mode matrix', () => {
  let harness: EmbeddingSearchHarness;

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
    } as Response);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (harness) {
      await destroyEmbeddingSearchHarness(harness, [ENTRY_PRIMARY, ENTRY_ANALYSIS]);
    }
  });

  it('T-I-024 semantic document search invokes chunk RPC and returns document rows', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-169-chunk-search-semantic',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    await addSearchDocument({
      harness,
      path: 'chunk-semantic.md',
      title: 'Chunk Semantic',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'semantic',
      mode: 'semantic',
      entity_types: ['documents'],
    });
    const payload = parseToolJson<{
      embeddings_queried: string[];
      results: Array<{ path: string; matched_chunks: Array<{ chunk_id: string; breadcrumb: string }> }>;
    }>(result);

    expect(payload.embeddings_queried).toEqual([ENTRY_PRIMARY]);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({
      path: 'chunk-semantic.md',
      matched_chunks: [expect.objectContaining({ breadcrumb: 'Chunk Semantic' })],
    });
  }, 90_000);

  it('T-I-026 search payload includes chunk metadata, ranks, and freshness map', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-169-chunk-search-metadata',
      entries: [{ name: ENTRY_PRIMARY }, { name: ENTRY_ANALYSIS }],
    });
    await addSearchDocument({
      harness,
      path: 'chunk-metadata.md',
      title: 'Chunk Metadata',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0], [ENTRY_ANALYSIS]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'metadata',
      mode: 'semantic',
      entity_types: ['documents'],
    });
    const payload = parseToolJson<{
      fusion: string;
      results: Array<{ matched_chunks: Array<Record<string, unknown>> }>;
    }>(result);

    expect(payload.fusion).toBe('rrf');
    expect(payload.results[0].matched_chunks[0]).toEqual(
      expect.objectContaining({
        chunk_id: expect.any(String),
        heading_path: 'Chunk Metadata',
        breadcrumb: 'Chunk Metadata',
        content: 'Body for Chunk Metadata',
        score: expect.any(Number),
        per_embedding_ranks: { [ENTRY_PRIMARY]: 1, [ENTRY_ANALYSIS]: 1 },
        indexed_at: expect.objectContaining({
          [ENTRY_PRIMARY]: expect.any(String),
          [ENTRY_ANALYSIS]: expect.any(String),
        }),
      })
    );
  }, 90_000);

  it('T-I-027 limit_chunks_per_result caps chunks independently of document limit', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-169-chunk-search-cap',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    const documentId = await addSearchDocument({
      harness,
      path: 'chunk-cap.md',
      title: 'Chunk Cap',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });
    await addExtraChunk({
      harness,
      documentId,
      heading: 'Chunk Cap > Extra',
      content: 'extra cap content',
      vectors: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'cap',
      mode: 'semantic',
      entity_types: ['documents'],
      limit: 1,
      limit_chunks_per_result: 1,
    });
    const payload = parseToolJson<{ results: Array<{ matched_chunks: unknown[] }> }>(result);

    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].matched_chunks).toHaveLength(1);
  }, 90_000);

  it('T-U-038 returns invalid_input for invalid limit_chunks_per_result', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-169-chunk-search-invalid-cap',
      entries: [{ name: ENTRY_PRIMARY }],
    });

    const result = await harness.server.search({
      query: 'cap',
      mode: 'semantic',
      entity_types: ['documents'],
      limit_chunks_per_result: 0,
    });
    const payload = parseToolJson<{ error: string; identifier: string }>(result);
    expect(payload).toMatchObject({
      error: 'invalid_input',
      identifier: 'limit_chunks_per_result',
    });
  }, 90_000);
});
