import { describe, expect, it, vi } from 'vitest';
import { registerGraphTools } from '../../src/mcp/tools/graph.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

const nodeId = '00000000-0000-4000-8000-000000000001';

vi.mock('../../src/utils/pg-client.js', () => ({
  withPgClient: vi.fn(async (_databaseUrl: string, callback: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => {
    const client = {
      async query(sql: string) {
        if (sql.includes('FROM fqc_graph_nodes')) {
          return {
            rows: [
              {
                chunk_id: nodeId,
                instance_id: 'unit',
                document_id: '00000000-0000-4000-8000-000000000002',
                document_path: 'Graph.md',
                document_title: 'Graph',
                document_status: 'active',
                heading_path: 'Graph',
                breadcrumb: 'Graph',
                content: 'Seeded graph chunk content',
                content_hash: 'hash-a',
                provenance_basis: 'source',
                question_status: null,
                question_resolution: null,
                community_id: null,
                community_label: null,
                community_summary: null,
                key_claims: null,
                chunk_summary: null,
                certainty_level: null,
                staleness_risk: null,
                external_refs: null,
                temporal_markers: null,
                analyzed_content_hash: 'hash-a',
                analyzed_by_model: 'mock',
                analyzed_at: '2026-06-29T00:00:00.000Z',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    return await callback(client);
  }),
}));

function makeConfig(): FlashQueryConfig {
  return {
    instance: { id: 'unit', name: 'Unit', vault: { path: '/tmp/fq-unit', markdownExtensions: ['.md'] } },
    supabase: { url: 'https://example.invalid', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db' },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    embeddings: [],
    graph: { enabled: true },
    logging: { level: 'info', output: 'stderr' },
    locking: { enabled: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
  } as FlashQueryConfig;
}

describe('query_graph MCP tool', () => {
  it('T-U-007 accepts and forwards include_content through the public schema', async () => {
    let capturedConfig: { inputSchema: Record<string, { safeParse: (value: unknown) => { success: boolean } }> } | undefined;
    let capturedHandler: ((input: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>) | undefined;
    const server = {
      registerTool: vi.fn((_name: string, config, handler) => {
        capturedConfig = config as typeof capturedConfig;
        capturedHandler = handler as typeof capturedHandler;
      }),
    };

    registerGraphTools(server as never, makeConfig());

    expect(capturedConfig?.inputSchema.include_content.safeParse(true).success).toBe(true);
    expect(capturedConfig?.inputSchema.include_content.safeParse('true').success).toBe(false);

    const suppressed = await capturedHandler?.({
      action: 'node',
      chunk_id: nodeId,
      include_content: false,
    });
    const suppressedPayload = JSON.parse(suppressed?.content[0]?.text ?? '{}') as {
      data: { node: { content: string | null } };
    };
    expect(suppressedPayload.data.node.content).toBeNull();

    const included = await capturedHandler?.({
      action: 'node',
      chunk_id: nodeId,
      include_content: true,
    });
    const includedPayload = JSON.parse(included?.content[0]?.text ?? '{}') as {
      data: { node: { content: string | null } };
    };
    expect(includedPayload.data.node.content).toBe('Seeded graph chunk content');
  });
});
