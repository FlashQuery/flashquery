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

async function addSearchMemory(input: {
  harness: EmbeddingSearchHarness;
  content: string;
  vectorByEntry: Record<string, number[]>;
}): Promise<string> {
  const memoryId = randomUUID();
  await input.harness.client.query(
    `INSERT INTO fqc_memory (id, instance_id, content, tags, plugin_scope, status, is_latest)
     VALUES ($1, $2, $3, $4, 'global', 'active', true)`,
    [memoryId, input.harness.config.instance.id, input.content, ['search166']]
  );
  for (const [entryName, vector] of Object.entries(input.vectorByEntry)) {
    await input.harness.client.query(
      `UPDATE fqc_memory
       SET ${pg.escapeIdentifier(`embedding_${entryName}`)} = $1::vector,
           ${pg.escapeIdentifier(`embedding_${entryName}_model`)} = $2,
           ${pg.escapeIdentifier(`embedding_${entryName}_dimensions`)} = $3,
           ${pg.escapeIdentifier(`embedding_${entryName}_provider`)} = 'search-provider',
           ${pg.escapeIdentifier(`embedding_${entryName}_truncated`)} = false
       WHERE id = $4`,
      [`[${vector.join(',')}]`, `model-${entryName}`, vector.length, memoryId]
    );
  }
  return memoryId;
}

describe.skipIf(!HAS_SUPABASE).sequential('chunk search mode matrix', () => {
  let harness: EmbeddingSearchHarness | undefined;

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
      harness = undefined;
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
        span_start: null,
        span_end: null,
      })
    );
  }, 90_000);

  it('T-I-025 preserves zero-active, partial retriever failure, and memory-beside-documents behavior', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-169-chunk-search-zero-active',
      entries: [{ name: ENTRY_PRIMARY, status: 'deactivated' }],
    });

    const zeroActive = await harness.server.search({
      query: 'inactive',
      mode: 'semantic',
      entity_types: ['documents'],
    });
    expect(parseToolJson<{ error: string; details: { reason: string } }>(zeroActive)).toMatchObject({
      error: 'unsupported',
      details: { reason: 'zero_active_embeddings' },
    });
    await destroyEmbeddingSearchHarness(harness, [ENTRY_PRIMARY]);
    harness = undefined;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const body = JSON.parse(String((options as RequestInit).body));
      if (String(body.model).includes(ENTRY_ANALYSIS)) {
        return { ok: false, status: 500, text: async () => 'provider down' } as Response;
      }
      return { ok: true, json: async () => ({ data: [{ embedding: [1, 0, 0] }] }) } as Response;
    });
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-169-chunk-search-preservation',
      entries: [{ name: ENTRY_PRIMARY }, { name: ENTRY_ANALYSIS }],
    });
    await addSearchDocument({
      harness,
      path: 'chunk-preserve.md',
      title: 'Chunk Preserve',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0], [ENTRY_ANALYSIS]: [1, 0, 0] },
    });
    await addSearchMemory({
      harness,
      content: 'memory preserve content',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0], [ENTRY_ANALYSIS]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'preserve',
      mode: 'semantic',
      entity_types: ['documents', 'memories'],
      limit: 5,
    });
    const payload = parseToolJson<{
      embeddings_queried: string[];
      warnings: string[];
      results: Array<{
        entity_type: string;
        path?: string;
        content_preview?: string;
        matched_chunks?: unknown[];
      }>;
    }>(result);

    expect(payload.embeddings_queried).toEqual([ENTRY_PRIMARY]);
    expect(payload.warnings).toContain(`partial_retriever_failure:${ENTRY_ANALYSIS}`);
    expect(payload.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'document',
          path: 'chunk-preserve.md',
          matched_chunks: [expect.objectContaining({ breadcrumb: 'Chunk Preserve' })],
        }),
        expect.objectContaining({
          entity_type: 'memory',
          content_preview: 'memory preserve content',
        }),
      ])
    );
    const memoryResult = payload.results.find((item) => item.entity_type === 'memory');
    expect(memoryResult).not.toHaveProperty('matched_chunks');
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
    await addExtraChunk({
      harness,
      documentId,
      heading: 'Chunk Cap > More',
      content: 'more cap content',
      vectors: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'cap',
      mode: 'semantic',
      entity_types: ['documents'],
      limit: 10,
      limit_chunks_per_result: 2,
    });
    const payload = parseToolJson<{ results: Array<{ matched_chunks: unknown[] }> }>(result);

    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].matched_chunks).toHaveLength(2);
  }, 90_000);

  it('T-I-032 returns AS-BUILT memory shape beside chunked document results', async () => {
    harness = await createEmbeddingSearchHarness({
      instanceId: 'phase-169-chunk-search-memory-shape',
      entries: [{ name: ENTRY_PRIMARY }],
    });
    await addSearchDocument({
      harness,
      path: 'chunk-memory-shape.md',
      title: 'Chunk Memory Shape',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });
    await addSearchMemory({
      harness,
      content: 'memory shape content',
      vectorByEntry: { [ENTRY_PRIMARY]: [1, 0, 0] },
    });

    const result = await harness.server.search({
      query: 'shape',
      mode: 'semantic',
      entity_types: ['documents', 'memories'],
      limit: 5,
    });
    const payload = parseToolJson<{
      results: Array<{
        entity_type: string;
        memory_id?: string;
        content_preview?: string;
        plugin_scope?: string;
        matched_chunks?: unknown[];
      }>;
    }>(result);

    expect(payload.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: 'document',
          matched_chunks: [expect.objectContaining({ breadcrumb: 'Chunk Memory Shape' })],
        }),
        expect.objectContaining({
          entity_type: 'memory',
          memory_id: expect.any(String),
          content_preview: 'memory shape content',
          plugin_scope: 'global',
        }),
      ])
    );
    const memoryResult = payload.results.find((item) => item.entity_type === 'memory');
    expect(memoryResult).not.toHaveProperty('matched_chunks');
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
