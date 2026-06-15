import { describe, expect, it, vi } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';

const mocks = vi.hoisted(() => ({
  withPgClient: vi.fn(),
  readFile: vi.fn(),
  diffAndPersistDocumentChunks: vi.fn(),
}));

vi.mock('../../src/utils/pg-client.js', () => ({
  withPgClient: mocks.withPgClient,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
}));

vi.mock('../../src/embedding/chunks/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/embedding/chunks/store.js')>();
  return {
    ...actual,
    diffAndPersistDocumentChunks: mocks.diffAndPersistDocumentChunks,
  };
});

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'chunk-lifecycle-unit',
      id: 'chunk-lifecycle-unit',
      vault: { path: '/tmp/chunk-lifecycle-unit', markdownExtensions: ['.md'] },
    },
    supabase: {
      url: 'https://test.supabase.co',
      serviceRoleKey: 'test-key',
      databaseUrl: 'postgresql://localhost:5432/test',
      skipDdl: false,
    },
    logging: { level: 'error', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

function setupPg(
  rowsBySql: Array<{
    match: string;
    rows: Record<string, unknown>[] | ((params: unknown[] | undefined) => Record<string, unknown>[]);
  }>
): void {
  mocks.withPgClient.mockImplementation(async (_databaseUrl, callback) => {
    return await callback({
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const found = rowsBySql.find((entry) => sql.includes(entry.match));
        const rows = typeof found?.rows === 'function' ? found.rows(params) : found?.rows;
        return { rows: rows ?? [] };
      }),
    });
  });
}

describe('chunk lifecycle work planning', () => {
  it('T-U-031 counts document chunks as lifecycle rows and reports by-document breakdown', async () => {
    vi.clearAllMocks();
    mocks.readFile.mockResolvedValue('# Doc One\n\nbody');
    mocks.diffAndPersistDocumentChunks.mockResolvedValue({
      chunks: [],
      newChunks: [],
      changedChunks: [],
      unchangedChunks: [],
      orphanChunks: [],
      chunksNeedingEmbedding: [],
      operations: [],
    });
    setupPg([
      {
        match: 'FROM fqc_embeddings',
        rows: [{ name: 'primary', dimensions: 3, endpoints: [], status: 'active' }],
      },
      {
        match: 'FROM fqc_documents',
        rows: [{ id: 'doc-1', path: 'docs/one.md', title: 'Doc One', updated_at: '2026-06-14T00:00:00.000Z' }],
      },
      {
        match: 'FROM fqc_chunks',
        rows: [
          {
            id: 'chunk-1',
            document_id: 'doc-1',
            path: 'docs/one.md',
            title: 'Doc One',
            heading_path: 'Doc One > A',
            breadcrumb: 'Doc One > A',
            content: 'alpha',
            embedding_primary_model: null,
            embedding_primary_dimensions: null,
            has_embedding: false,
          },
          {
            id: 'chunk-2',
            document_id: 'doc-1',
            path: 'docs/one.md',
            title: 'Doc One',
            heading_path: 'Doc One > B',
            breadcrumb: 'Doc One > B',
            content: 'beta',
            embedding_primary_model: null,
            embedding_primary_dimensions: null,
            has_embedding: false,
          },
        ],
      },
    ]);

    const { resolveCoreLifecycleWorkPlan } = await import('../../src/embedding/lifecycle/core-processor.js');
    const result = await resolveCoreLifecycleWorkPlan(
      makeConfig(),
      { action: 'backfill_embeddings', embedding_name: 'primary', scope: { entity_types: ['documents'] } },
      'backfill_embeddings'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.payload.rows).toHaveLength(2);
    expect(result.payload.rows.map((row) => row.entity_type)).toEqual(['document_chunk', 'document_chunk']);
    expect(result.payload.byDocument).toEqual([
      {
        document_id: 'doc-1',
        path: 'docs/one.md',
        chunks_examined: 2,
        chunks_embedded: 0,
        chunks_failed: 0,
        chunks_skipped_already_present: 0,
      },
    ]);
  });

  it('T-U-032 dry-run parses scoped documents without persisting chunks and counts only missing backfill vectors', async () => {
    vi.clearAllMocks();
    const alphaBody = Array.from({ length: 120 }, () => 'alpha').join(' ');
    const betaBody = Array.from({ length: 120 }, () => 'beta').join(' ');
    mocks.readFile.mockResolvedValue(`# Doc One\n\n## A\n\n${alphaBody}\n\n## B\n\n${betaBody}`);
    setupPg([
      {
        match: 'FROM fqc_embeddings',
        rows: [{ name: 'primary', dimensions: 3, endpoints: [], status: 'active' }],
      },
      {
        match: 'FROM fqc_documents',
        rows: [{ id: 'doc-1', path: 'docs/one.md', title: 'Doc One', updated_at: '2026-06-14T00:00:00.000Z' }],
      },
      {
        match: 'AND id = ANY($3::uuid[])',
        rows: (params) => [{ id: ((params?.[2] as string[]) ?? [])[0] }],
      },
    ]);

    const { runCoreLifecycle } = await import('../../src/embedding/lifecycle/core-processor.js');
    const result = await runCoreLifecycle({
      config: makeConfig(),
      input: {
        action: 'backfill_embeddings',
        embedding_name: 'primary',
        scope: { entity_types: ['documents'] },
        dry_run: true,
      },
      mode: 'backfill_embeddings',
    });

    expect(result.ok).toBe(true);
    expect(mocks.diffAndPersistDocumentChunks).not.toHaveBeenCalled();
    if (!result.ok) throw new Error(result.error.message);
    expect(result.payload.dry_run).toBe(true);
    expect(result.payload.would_process_documents).toBe(1);
    expect(result.payload.would_process_chunks).toBe(1);
    expect(result.payload.counts.rows_examined).toBe(1);
    expect(result.payload.counts.rows_skipped_already_present).toBe(1);
    expect(result.payload.by_document).toEqual([
      {
        document_id: 'doc-1',
        path: 'docs/one.md',
        chunks_examined: 1,
        chunks_embedded: 0,
        chunks_failed: 0,
        chunks_skipped_already_present: 1,
      },
    ]);
  });

  it('T-U-033 caps by_document after preserving failed documents first', async () => {
    vi.clearAllMocks();
    mocks.readFile.mockResolvedValue('# Doc\n\nbody');
    setupPg([
      {
        match: 'FROM fqc_embeddings',
        rows: [{ name: 'primary', dimensions: 3, endpoints: [], status: 'active' }],
      },
      {
        match: 'FROM fqc_documents',
        rows: [
          { id: 'doc-a', path: 'docs/a.md', title: 'A', updated_at: '2026-06-14T00:00:00.000Z' },
          { id: 'doc-b', path: 'docs/b.md', title: 'B', updated_at: '2026-06-14T00:00:00.000Z' },
        ],
      },
      {
        match: 'FROM fqc_chunks',
        rows: [
          {
            id: 'chunk-a',
            document_id: 'doc-a',
            path: 'docs/a.md',
            title: 'A',
            heading_path: 'A',
            breadcrumb: 'A',
            content: 'a',
            embedding_primary_model: null,
            embedding_primary_dimensions: null,
            has_embedding: false,
          },
          {
            id: 'chunk-b',
            document_id: 'doc-b',
            path: 'docs/b.md',
            title: 'B',
            heading_path: 'B',
            breadcrumb: 'B',
            content: 'b',
            embedding_primary_model: null,
            embedding_primary_dimensions: null,
            has_embedding: false,
          },
        ],
      },
    ]);

    const { resolveCoreLifecycleWorkPlan, applyByDocumentLifecycleCap } = await import(
      '../../src/embedding/lifecycle/core-processor.js'
    );
    const result = await resolveCoreLifecycleWorkPlan(
      makeConfig(),
      {
        action: 'backfill_embeddings',
        embedding_name: 'primary',
        scope: { entity_types: ['documents'] },
        max_documents_in_response: 1,
      },
      'backfill_embeddings'
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const capped = applyByDocumentLifecycleCap(
      result.payload.byDocument.map((doc) =>
        doc.document_id === 'doc-b' ? { ...doc, chunks_failed: 1 } : doc
      ),
      1
    );
    expect(capped.by_document).toEqual([
      expect.objectContaining({ document_id: 'doc-b', chunks_failed: 1 }),
    ]);
    expect(capped.by_document_truncated).toBe(true);
  });
});
