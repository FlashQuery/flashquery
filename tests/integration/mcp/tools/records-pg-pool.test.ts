import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../../../src/config/loader.js';

const pgClientMock = vi.hoisted(() => ({
  createPgClientIPv4: vi.fn(() => {
    throw new Error('direct pg client should not be used for record vector SQL');
  }),
  queryPgPool: vi.fn(),
}));

vi.mock('../../../../src/utils/pg-client.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/utils/pg-client.js')>(
    '../../../../src/utils/pg-client.js'
  );
  return {
    ...actual,
    createPgClientIPv4: pgClientMock.createPgClientIPv4,
    queryPgPool: pgClientMock.queryPgPool,
  };
});

vi.mock('../../../../src/embedding/provider.js', () => ({
  embeddingProvider: {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  },
}));

vi.mock('../../../../src/services/plugin-reconciliation.js', () => ({
  reconcilePluginDocuments: vi.fn().mockResolvedValue({}),
  executeReconciliationActions: vi.fn().mockResolvedValue({
    autoTracked: 0,
    archived: 0,
    resurrected: 0,
    pathsUpdated: 0,
    fieldsSynced: 0,
    pendingReviewsCreated: 0,
    pendingReviewsCleared: 0,
  }),
}));

const tableSpec = {
  name: 'contacts',
  description: 'Contacts',
  embed_fields: ['name', 'notes'],
  columns: [
    { name: 'name', type: 'text', required: true },
    { name: 'notes', type: 'text' },
  ],
};

vi.mock('../../../../src/plugins/manager.js', () => ({
  pluginManager: {
    getTableSpec: vi.fn(() => ({
      fullTableName: 'fqcp_crm_default_contacts',
      tableSpec,
      entry: {},
    })),
  },
  resolveTableName: vi.fn(() => 'fqcp_crm_default_contacts'),
}));

function makeQueryResult(data: unknown) {
  return { data, error: null };
}

function makeSupabase() {
  let insertCounter = 0;
  return {
    from(table: string) {
      if (table === 'fqc_pending_plugin_review') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve(makeQueryResult([])),
            }),
          }),
        };
      }
      if (table === 'fqc_pending_embeds') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => Promise.resolve(makeQueryResult([])),
                }),
              }),
            }),
          }),
          upsert: vi.fn().mockResolvedValue(makeQueryResult(null)),
        };
      }
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              insertCounter += 1;
              return Promise.resolve(
                makeQueryResult({
                  ...row,
                  id: `record-${insertCounter}`,
                  status: 'active',
                })
              );
            },
          }),
        }),
      };
    },
  };
}

vi.mock('../../../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => makeSupabase()),
  },
}));

vi.mock('../../../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../../src/services/write-lock.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

import { registerRecordTools } from '../../../../src/mcp/tools/records.js';

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function makeConfig(): FlashQueryConfig {
  return {
    instance: { id: 'records-pool-test', name: 'records-pool-test' },
    supabase: {
      url: 'http://localhost:54321',
      serviceRoleKey: 'test',
      databaseUrl: 'postgres://user:pass@localhost:5432/fq',
      skipDdl: true,
    },
    locking: { enabled: false, ttlSeconds: 30 },
  } as FlashQueryConfig;
}

function parseResult(result: unknown): Record<string, unknown> {
  const toolResult = result as { content: Array<{ text: string }>; isError?: boolean };
  expect(toolResult.isError).toBeUndefined();
  return JSON.parse(toolResult.content[0].text) as Record<string, unknown>;
}

describe('record pooled pg vector SQL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgClientMock.queryPgPool.mockResolvedValue({
      rows: [
        {
          id: 'record-1',
          instance_id: 'records-pool-test',
          status: 'active',
          name: 'Alice Engineer',
          notes: 'TypeScript systems',
          similarity: 0.92,
        },
      ],
    });
  });

  it('T-I-007 completes concurrent write_record embed_fields updates through the pool', async () => {
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, makeConfig());

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        getHandler('write_record')({
          mode: 'create',
          plugin_id: 'crm',
          table: 'contacts',
          data: {
            name: `Contact ${index}`,
            notes: `Pooled embedding note ${index}`,
          },
        })
      )
    );

    const payloads = results.map(parseResult);
    expect(payloads).toHaveLength(20);
    expect(payloads.every((payload) => !('warnings' in payload))).toBe(true);
    expect(pgClientMock.queryPgPool).toHaveBeenCalledTimes(20);
    expect(pgClientMock.createPgClientIPv4).not.toHaveBeenCalled();
  });

  it('T-I-008 semantic search_records uses pooled vector SQL and returns scored rows', async () => {
    const { server, getHandler } = createMockServer();
    registerRecordTools(server, makeConfig());

    const payload = parseResult(
      await getHandler('search_records')({
        plugin_id: 'crm',
        table: 'contacts',
        query: 'TypeScript engineer',
        include: ['data'],
      })
    );

    expect(payload.total).toBe(1);
    expect(payload.results).toEqual([
      expect.objectContaining({
        score: 0.92,
      }),
    ]);
    expect(pgClientMock.queryPgPool).toHaveBeenCalledWith(
      'postgres://user:pass@localhost:5432/fq',
      expect.stringContaining('embedding <=> $1::vector'),
      expect.arrayContaining(['[0.1,0.2,0.3]', 'records-pool-test', 10])
    );
    expect(pgClientMock.createPgClientIPv4).not.toHaveBeenCalled();
  });
});
