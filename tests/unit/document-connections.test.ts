import { describe, expect, it, vi } from 'vitest';
import { buildDocumentConnections, buildGraphPrimaryConnections } from '../../src/mcp/utils/document-connections.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

function makeConfig(input: { embeddings?: FlashQueryConfig['embeddings'] } = {}): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    embeddings: input.embeddings ?? [{ name: 'primary', provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536, endpoints: [] }],
    logging: { level: 'info', output: 'stderr' },
    locking: { enabled: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
  } as FlashQueryConfig;
}

function resolvedQuery(data: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    not: vi.fn(() => query),
    then: (resolve: (value: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve),
  };
  return query;
}

describe('document connection builder', () => {
  it('returns unsupported when embeddings are not configured in flashquery.yml', async () => {
    const supabase = {
      from: vi.fn(),
      rpc: vi.fn(),
    };

    const result = await buildDocumentConnections({
      supabase: supabase as never,
      config: makeConfig({ embeddings: [] }),
      sourceDocumentId: 'source-doc',
    });

    expect(result.result).toBeUndefined();
    expect(result.error).toMatchObject({
      error: 'unsupported',
      identifier: 'connections',
      details: { reason: 'embeddings_not_configured' },
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('returns empty connections when embeddings are enabled but the document has no embedded chunks yet', async () => {
    const rpc = vi.fn();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'fqc_embeddings') {
          return resolvedQuery([{ name: 'primary', dimensions: 1536, endpoints: [], status: 'active' }]);
        }
        if (table === 'fqc_chunks') {
          return resolvedQuery([]);
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      rpc,
    };

    const result = await buildDocumentConnections({
      supabase: supabase as never,
      config: makeConfig(),
      sourceDocumentId: 'source-doc',
    });

    expect(result.error).toBeUndefined();
    expect(result.result).toEqual({ overall: [], source_chunks: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses stored chunk vectors, filters self-document hits, dedupes targets, and sorts by best similarity', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [
          { document_id: 'source-doc', chunk_id: 'self', path: 'Source.md', title: 'Source', similarity: 0.99 },
          { document_id: 'doc-alpha', chunk_id: 'alpha', path: 'Alpha.md', title: 'Alpha', similarity: 0.81 },
          { document_id: 'doc-beta', chunk_id: 'beta', path: 'Beta.md', title: 'Beta', similarity: 0.94, heading_path: 'Beta Section', content: 'beta body' },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { document_id: 'doc-alpha', chunk_id: 'alpha', path: 'Alpha.md', title: 'Alpha', similarity: 0.91 },
          { document_id: 'doc-gamma', chunk_id: 'gamma', path: 'Gamma.md', title: 'Gamma', similarity: 0.72 },
        ],
        error: null,
      });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'fqc_embeddings') {
          return resolvedQuery([{ name: 'primary', dimensions: 1536, endpoints: [], status: 'active' }]);
        }
        if (table === 'fqc_chunks') {
          return resolvedQuery([
            { id: 'source-a', heading_path: 'A', breadcrumb: 'A', embedding_primary: '[1,0]' },
            { id: 'source-b', heading_path: 'B', breadcrumb: 'B', embedding_primary: '[0,1]' },
          ]);
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      rpc,
    };

    const result = await buildDocumentConnections({
      supabase: supabase as never,
      config: makeConfig(),
      sourceDocumentId: 'source-doc',
      options: { limit: 3, limit_per_chunk: 2 },
    });

    expect(result.error).toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('match_chunks_primary', expect.objectContaining({
      query_embedding: '[1,0]',
      match_threshold: 0.4,
      include_archived: false,
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'match_chunks_primary', expect.objectContaining({
      query_embedding: '[0,1]',
    }));
    expect(result.result?.overall.map((connection) => [connection.target.path, connection.score])).toEqual([
      ['Beta.md', 0.94],
      ['Alpha.md', 0.91],
      ['Gamma.md', 0.72],
    ]);
    expect(result.result?.source_chunks).toHaveLength(2);
    expect(result.result?.source_chunks[0]?.connections.map((connection) => connection.target.path)).toEqual([
      'Beta.md',
      'Alpha.md',
    ]);
  });

  it('builds graph-primary connections with relation overlays and hides inactive targets by default', () => {
    const result = buildGraphPrimaryConnections({
      sourceChunkIds: ['source-a'],
      sourceChunkMetadata: new Map([
        ['source-a', { heading_path: 'Source', breadcrumb: 'Source' }],
      ]),
      edges: [
        {
          id: 'edge-active',
          source_chunk_id: 'source-a',
          target_chunk_id: 'target-active',
          relation: 'supports',
          confidence_score: 0.92,
          reasoning: 'explicitly supports the claim',
          status: 'active',
        },
        {
          id: 'edge-archived',
          source_chunk_id: 'source-a',
          target_chunk_id: 'target-archived',
          relation: 'references',
          confidence_score: 1,
          reasoning: null,
          status: 'active',
        },
      ],
      targets: new Map([
        ['target-active', {
          chunk_id: 'target-active',
          document_id: 'doc-active',
          path: 'Active.md',
          title: 'Active',
          heading_path: 'Active Heading',
          content: 'active body',
          document_status: 'active',
          question_status: 'open',
          community_label: 'Claims',
        }],
        ['target-archived', {
          chunk_id: 'target-archived',
          document_id: 'doc-archived',
          path: 'Archived.md',
          title: 'Archived',
          document_status: 'archived',
          question_status: null,
          community_label: 'Archive',
        }],
      ]),
      options: { graph_limit_per_chunk: 5 },
    });

    expect(result.overall.map((connection) => connection.target.path)).toEqual(['Active.md']);
    expect(result.overall[0]).toMatchObject({
      basis: 'graph',
      direction: 'out',
      relation: 'supports',
      confidence_score: 0.92,
      reasoning: 'explicitly supports the claim',
      stale: false,
      question_status: 'open',
      community_label: 'Claims',
      target: {
        document_status: 'active',
      },
    });
    expect(result.source_chunks[0]?.connections).toHaveLength(1);
  });

  it('appends embedding-only neighbors only when include_embedding_only is enabled', () => {
    const graphResult = buildGraphPrimaryConnections({
      sourceChunkIds: ['source-a'],
      sourceChunkMetadata: new Map(),
      edges: [
        {
          id: 'edge-active',
          source_chunk_id: 'source-a',
          target_chunk_id: 'target-active',
          relation: 'supports',
          confidence_score: 0.92,
          reasoning: null,
          status: 'active',
        },
      ],
      targets: new Map([
        ['target-active', {
          chunk_id: 'target-active',
          document_id: 'doc-active',
          path: 'Active.md',
          title: 'Active',
          document_status: 'active',
          question_status: null,
          community_label: null,
        }],
      ]),
      embeddingOnly: {
        overall: [
          {
            id: 'Embedding.md#target-embedding',
            score: 0.8,
            target: {
              chunk_id: 'target-embedding',
              document_id: 'doc-embedding',
              path: 'Embedding.md',
              title: 'Embedding',
            },
          },
        ],
        source_chunks: [
          {
            chunk_id: 'source-a',
            connections: [
              {
                id: 'Embedding.md#target-embedding',
                score: 0.8,
                target: {
                  chunk_id: 'target-embedding',
                  document_id: 'doc-embedding',
                  path: 'Embedding.md',
                  title: 'Embedding',
                },
              },
            ],
          },
        ],
      },
      options: { graph_limit_per_chunk: 5, include_embedding_only: true },
    });

    expect(graphResult.overall.map((connection) => [connection.basis, connection.target.path])).toEqual([
      ['graph', 'Active.md'],
      ['embedding', 'Embedding.md'],
    ]);
    expect(graphResult.source_chunks[0]?.connections.map((connection) => [connection.basis, connection.target.path])).toEqual([
      ['graph', 'Active.md'],
      ['embedding', 'Embedding.md'],
    ]);
  });

  it('preserves legacy limit_per_chunk when graph-aware options are absent', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { document_id: 'doc-alpha', chunk_id: 'alpha', path: 'Alpha.md', title: 'Alpha', similarity: 0.81 },
      ],
      error: null,
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'fqc_embeddings') {
          return resolvedQuery([{ name: 'primary', dimensions: 1536, endpoints: [], status: 'active' }]);
        }
        if (table === 'fqc_chunks') {
          return resolvedQuery([
            { id: 'source-a', heading_path: 'A', breadcrumb: 'A', embedding_primary: '[1,0]' },
          ]);
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      rpc,
    };

    const result = await buildDocumentConnections({
      supabase: supabase as never,
      config: makeConfig(),
      sourceDocumentId: 'source-doc',
      options: { limit_per_chunk: 1 },
    });

    expect(result.error).toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('match_chunks_primary', expect.objectContaining({
      match_count: 51,
    }));
    expect(result.result?.source_chunks[0]?.connections).toHaveLength(1);
  });
});
